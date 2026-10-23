/**
 * XIANG SPACE — v3.0 Zero-Jank & Timeline Edition
 *
 * Key Upgrades:
 * 1. ZERO-JANK VIEWER: Removed automatic 10MB HD image decode on click & stripped backdrop-filter.
 *    Clicking a photo now reuses the already-decoded bitmap in <16ms, with an optional "LOAD ORIGINAL HD" button.
 * 2. CHRONOLOGICAL TIMELINE: Automatically groups photos by Date (TODAY / YESTERDAY / YYYY.MM.DD)
 *    with one-click per-day selection and true aspect-ratio masonry inside each date group.
 * 3. R2 10GB STORAGE QUOTA METER: Live top-bar quota gauge + multi-color category breakdown in Settings.
 */

document.addEventListener("DOMContentLoaded", () => {
    const STORAGE_KEYS = {
        ADMIN_TOKEN: 'xiang_r2_token',
        CUSTOM_DOMAIN: 'xiang_r2_domain',
        UPLOAD_MODE: 'xiang_r2_upload_mode',
        LOCAL_ITEMS: 'xiang_r2_local_items',
        ZOOM_DESKTOP: 'xiang_r2_zoom_desktop',
        ZOOM_MOBILE: 'xiang_r2_zoom_mobile'
    };

    // Cloudflare R2 Free Tier = 10 GB (10 * 1024 * 1024 * 1024 bytes)
    const R2_FREE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

    const isLocalhost = (
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.protocol === 'file:'
    );

    let adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN) || '';
    let customDomain = localStorage.getItem(STORAGE_KEYS.CUSTOM_DOMAIN) || '';
    let uploadMode = localStorage.getItem(STORAGE_KEYS.UPLOAD_MODE) || 'original';

    // 仿 iPhone 相册缩略图档位：桌面端 1..5 (对应 7, 5, 4, 3, 2 列)，手机端 1..4 (对应 5, 3, 2, 1 列)
    let desktopZoomLevel = Math.min(5, Math.max(1, parseInt(localStorage.getItem(STORAGE_KEYS.ZOOM_DESKTOP) || '3', 10)));
    let mobileZoomLevel = Math.min(4, Math.max(1, parseInt(localStorage.getItem(STORAGE_KEYS.ZOOM_MOBILE) || '3', 10)));

    let isR2Connected = false;
    let isUnlocked = false;
    let allImages = [];
    let filteredImages = [];
    let currentFolder = 'all';
    let customFolders = new Set();
    let searchQuery = '';
    let isBatchMode = false;
    let selectedKeys = new Set();
    let activeViewerIdx = -1;

    /* =========================================================
       0. 莫兰迪/画廊分类色彩系统 (Category Color System)
    ========================================================= */
    const PRESET_FOLDER_COLORS = {
        all: '#0a0a0a',
        default: '#64748b',
        portfolio: '#2563eb',
        street: '#d97706',
        blog: '#059669',
        '3d': '#7c3aed',
        portrait: '#e11d48',
        film: '#0891b2',
        travel: '#ea580c',
        work: '#4f46e5'
    };

    const DYNAMIC_PALETTE = [
        '#2563eb', '#059669', '#d97706', '#7c3aed', '#e11d48',
        '#0891b2', '#4f46e5', '#b45309', '#0d9488', '#9333ea'
    ];

    function getCategoryColor(folderName) {
        const key = (folderName || 'default').toLowerCase().trim();
        if (PRESET_FOLDER_COLORS[key]) return PRESET_FOLDER_COLORS[key];
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            hash = key.charCodeAt(i) + ((hash << 5) - hash);
        }
        return DYNAMIC_PALETTE[Math.abs(hash) % DYNAMIC_PALETTE.length];
    }

    const SEED_DEMO = [
        {
            key: "portfolio/IMG_0635.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/color/IMG_0635.jpg",
            size: 2845120,
            uploaded: "2026-10-23T10:30:00.000Z",
            folder: "portfolio",
            originalName: "IMG_0635.jpg",
            title: "IMG_0635.jpg",
            width: 3840,
            height: 2560,
            isDemo: true,
            exif: { camera: "Canon EOS R5", lens: "RF 70-200mm F2.8", focal: "135mm", aperture: "f/4", shutter: "1/500s", iso: "160" }
        },
        {
            key: "portfolio/IMG_0801.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/line/IMG_0801.jpg",
            size: 1984000,
            uploaded: "2026-10-23T09:15:00.000Z",
            folder: "portfolio",
            originalName: "IMG_0801.jpg",
            title: "IMG_0801.jpg",
            width: 3000,
            height: 4000,
            isDemo: true,
            exif: { camera: "Hasselblad X2D", lens: "XCD 55V", focal: "55mm", aperture: "f/5.6", shutter: "1/640s", iso: "64" }
        },
        {
            key: "street/IMG_2655.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/city/IMG_2655.jpg",
            size: 3120400,
            uploaded: "2026-10-21T14:20:00.000Z",
            folder: "street",
            originalName: "IMG_2655.jpg",
            title: "IMG_2655.jpg",
            width: 3600,
            height: 2400,
            isDemo: true,
            exif: { camera: "Canon EOS R5", lens: "RF 24-70mm F2.8", focal: "50mm", aperture: "f/8", shutter: "1/250s", iso: "100" }
        },
        {
            key: "blog/IMG_2973.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/black/IMG_2973.jpg",
            size: 2450100,
            uploaded: "2026-10-18T18:00:00.000Z",
            folder: "blog",
            originalName: "IMG_2973.jpg",
            title: "IMG_2973.jpg",
            width: 3840,
            height: 2560,
            isDemo: true,
            exif: { camera: "Leica M11", lens: "Summilux-M 35mm", focal: "35mm", aperture: "f/5.6", shutter: "1/1000s", iso: "125" }
        }
    ];

    /* =========================================================
       1. 工具函数
    ========================================================= */
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDateHeading(isoStr) {
        if (!isoStr) return { key: 'ARCHIVE', title: 'ARCHIVE', sub: 'EARLIER' };
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return { key: 'ARCHIVE', title: 'ARCHIVE', sub: 'EARLIER' };

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateKey = `${yyyy}.${mm}.${dd}`;

        const now = new Date();
        const todayKey = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

        const yest = new Date(now);
        yest.setDate(now.getDate() - 1);
        const yestKey = `${yest.getFullYear()}.${String(yest.getMonth() + 1).padStart(2, '0')}.${String(yest.getDate()).padStart(2, '0')}`;

        const weekdays = ['SUN 周日', 'MON 周一', 'TUE 周二', 'WED 周三', 'THU 周四', 'FRI 周五', 'SAT 周六'];
        const wk = weekdays[d.getDay()];

        if (dateKey === todayKey) return { key: dateKey, title: `${dateKey}`, sub: `TODAY 今天 · ${wk}` };
        if (dateKey === yestKey) return { key: dateKey, title: `${dateKey}`, sub: `YESTERDAY 昨天 · ${wk}` };
        return { key: dateKey, title: `${dateKey}`, sub: wk };
    }

    function toast(msg) {
        const box = document.getElementById('toast-box');
        if (!box) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.2s ease';
            setTimeout(() => el.remove(), 220);
        }, 2000);
    }

    async function copyText(text, label = 'URL') {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        toast(`COPIED ${label}`);
    }

    function getFullUrl(item) {
        if (!item) return '';
        if (customDomain && item.key && !item.isDemo) {
            const base = customDomain.replace(/\/+$/, '');
            const encoded = item.key.split('/').map(encodeURIComponent).join('/');
            return `${base}/${encoded}`;
        }
        return item.url;
    }

    function getFastThumbUrl(item) {
        if (!item) return '';
        if (item.thumbKey && !item.isDemo) {
            if (customDomain) {
                const base = customDomain.replace(/\/+$/, '');
                const encoded = item.thumbKey.split('/').map(encodeURIComponent).join('/');
                return `${base}/${encoded}`;
            }
            return item.thumbUrl || getFullUrl(item);
        }
        const rawUrl = getFullUrl(item);
        if (rawUrl.includes('aliyuncs.com') && !rawUrl.includes('x-oss-process')) {
            return `${rawUrl}?x-oss-process=image/resize,l_960,limit_1/auto-orient,1/quality,q_84/format,webp`;
        }
        return rawUrl;
    }

    function buildFormats(item) {
        const url = getFullUrl(item);
        const name = item.title || item.originalName || 'image';
        return {
            url,
            md: `![${name}](${url})`,
            html: `<img src="${url}" alt="${name}" loading="lazy" />`
        };
    }

    function loadLocalItems() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_ITEMS);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {}
        return [...SEED_DEMO];
    }

    function saveLocalItems() {
        try {
            localStorage.setItem(STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(allImages.slice(0, 40)));
        } catch {}
    }

    /* =========================================================
       2. R2 10GB 免费可用空间实时统计仪表 (Storage Quota Meter)
    ========================================================= */
    const quotaPillText = document.getElementById('quota-pill-text');
    const quotaMiniFill = document.getElementById('quota-mini-fill');
    const meterPct = document.getElementById('meter-pct');
    const meterUsedVal = document.getElementById('meter-used-val');
    const meterFreeVal = document.getElementById('meter-free-val');
    const meterBarMulti = document.getElementById('meter-bar-multi');
    const meterCatBreakdown = document.getElementById('meter-cat-breakdown');

    function updateStorageQuotaUI() {
        const totalUsedBytes = allImages.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
        const freeBytes = Math.max(0, R2_FREE_QUOTA_BYTES - totalUsedBytes);
        const pct = Math.min(100, (totalUsedBytes / R2_FREE_QUOTA_BYTES) * 100);

        const usedFormatted = formatBytes(totalUsedBytes);
        const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

        if (quotaPillText) {
            quotaPillText.textContent = `${usedFormatted} / 10 GB`;
        }
        if (quotaMiniFill) {
            quotaMiniFill.style.width = `${Math.max(1.5, pct)}%`;
            quotaMiniFill.style.background = pct > 85 ? 'var(--danger)' : 'var(--ok)';
        }

        if (meterPct) meterPct.textContent = `${pct < 0.1 && totalUsedBytes > 0 ? '< 0.1' : pct.toFixed(1)}% USED`;
        if (meterUsedVal) meterUsedVal.textContent = `${usedFormatted} (${allImages.length} 张)`;
        if (meterFreeVal) meterFreeVal.textContent = freeGB;

        const catBytesMap = new Map();
        allImages.forEach(item => {
            const f = item.folder || 'default';
            catBytesMap.set(f, (catBytesMap.get(f) || 0) + (Number(item.size) || 0));
        });

        if (meterBarMulti && meterCatBreakdown) {
            meterBarMulti.innerHTML = '';
            meterCatBreakdown.innerHTML = '';

            if (totalUsedBytes === 0) {
                meterCatBreakdown.innerHTML = `<span>当前存储桶为空 · 10.00 GB 全部可用</span>`;
                return;
            }

            Array.from(catBytesMap.entries())
                .sort((a, b) => b[1] - a[1])
                .forEach(([folder, bytes]) => {
                    const color = getCategoryColor(folder);
                    const sharePct = Math.max(2, (bytes / totalUsedBytes) * 100);

                    const seg = document.createElement('div');
                    seg.className = 'meter-seg';
                    seg.style.width = `${sharePct}%`;
                    seg.style.background = color;
                    seg.title = `${folder.toUpperCase()}: ${formatBytes(bytes)}`;
                    meterBarMulti.appendChild(seg);

                    const itemEl = document.createElement('div');
                    itemEl.className = 'breakdown-item';
                    itemEl.innerHTML = `
                        <span class="breakdown-dot" style="background:${color}"></span>
                        <span>${folder.toUpperCase()}: ${formatBytes(bytes)}</span>
                    `;
                    meterCatBreakdown.appendChild(itemEl);
                });
        }
    }

    document.getElementById('btn-quota-detail')?.addEventListener('click', () => openSettings());
    document.getElementById('mob-btn-quota')?.addEventListener('click', () => openSettings());

    /* =========================================================
       3. 首屏严格密码门禁 (Strict Password Lock Screen)
          绝不在云端环境随意放行或回退演示模式
    ========================================================= */
    const lockScreen = document.getElementById('lock-screen');
    const lockForm = document.getElementById('lock-form');
    const lockInput = document.getElementById('lock-password-input');
    const lockError = document.getElementById('lock-error');
    const lockFooterHint = document.getElementById('lock-footer-hint');
    const r2ConnStatus = document.getElementById('r2-conn-status');

    function unlockUI() {
        isUnlocked = true;
        document.body.classList.remove('locked');
        lockScreen?.classList.add('unlocked');
        if (lockError) lockError.textContent = '';
    }

    function showLockUI(hintMessage = '') {
        isUnlocked = false;
        document.body.classList.remove('batch-active');
        document.body.classList.add('locked');
        lockScreen?.classList.remove('unlocked');
        if (hintMessage && lockError) {
            lockError.textContent = hintMessage;
        }
        setTimeout(() => lockInput?.focus(), 80);
    }

    function triggerLockShake(msg) {
        if (lockError) lockError.textContent = msg;
        if (lockForm) {
            lockForm.classList.remove('shake');
            void lockForm.offsetWidth;
            lockForm.classList.add('shake');
        }
    }

    // 页面启动时探测 Cloudflare 节点绑定状态
    async function probeServerStatus() {
        try {
            const res = await fetch('/api/images?action=status', { cache: 'no-store' });
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                if (lockFooterHint) {
                    lockFooterHint.textContent = isLocalhost
                        ? 'LOCAL DEV · 本地开发预览模式'
                        : 'CLOUDFLARE EDGE · 请输入访问密码';
                }
                return;
            }
            const info = await res.json();
            if (lockFooterHint) {
                if (info.r2Bound && info.passwordConfigured) {
                    lockFooterHint.textContent = 'CLOUDFLARE R2 NODE READY · 节点与密码保护已生效';
                } else if (info.r2Bound && info.needsFirstSetup) {
                    lockFooterHint.textContent = 'R2 存储桶已连接 · 首次输入您的密码将自动加密锁定此空间';
                } else if (!info.r2Bound) {
                    lockFooterHint.textContent = '请在 Cloudflare Bindings 绑定 R2 存储桶 BUCKET';
                }
            }
        } catch {
            if (lockFooterHint) {
                lockFooterHint.textContent = isLocalhost
                    ? 'LOCAL DEV · 本地预览模式'
                    : 'PROTECTED BY CLOUDFLARE R2 EDGE';
            }
        }
    }

    async function tryUnlockAndLoad(passwordAttempt, isInitialAutoCheck = false) {
        try {
            const headers = {};
            if (passwordAttempt) headers['Authorization'] = `Bearer ${passwordAttempt}`;

            const res = await fetch('/api/images', { headers, cache: 'no-store' });
            const ct = res.headers.get('content-type') || '';

            // 仅当在本地 localhost 静态打开且无 Worker 路由时允许本地演示
            if (!ct.includes('application/json')) {
                if (!isLocalhost) {
                    triggerLockShake('API 路由未就绪，请等待 Cloudflare 部署完成并刷新页面');
                    return false;
                }
                isR2Connected = false;
                if (!passwordAttempt) return false;
                adminToken = passwordAttempt;
                localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
                allImages = loadLocalItems();
                if (r2ConnStatus) r2ConnStatus.textContent = 'LOCAL PREVIEW · 本地开发演示模式';
                unlockUI();
                renderSpace();
                return true;
            }

            const data = await res.json();

            // 1. 密码错误：严格拦截，绝不进入演示模式！
            if (res.status === 401 || res.status === 403 || data.locked || !data.isAdmin) {
                localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
                adminToken = '';
                if (!isInitialAutoCheck) {
                    triggerLockShake(data.message || '密码错误，请重新输入 (INVALID PASSWORD)');
                } else {
                    showLockUI();
                }
                return false;
            }

            // 2. 密码验证通过！保存正确密码
            adminToken = passwordAttempt;
            localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
            isR2Connected = Boolean(data.r2Bound);

            if (data.firstTimeInitialized) {
                toast('已将您的密码 SHA-256 加密锁定至 R2 存储桶！');
            }

            // 3. 如果密码正确但 R2 存储桶未绑定
            if (!isR2Connected) {
                allImages = []; // 绝不混入假演示图片！
                if (r2ConnStatus) {
                    r2ConnStatus.textContent = '⚠️ R2 存储桶未绑定：请在 Cloudflare -> Settings -> Bindings 绑定 R2 桶 (变量名填 BUCKET)';
                }
                const emptyTitle = document.querySelector('.empty-title');
                const emptySub = document.querySelector('.empty-sub');
                if (emptyTitle) emptyTitle.textContent = '密码验证通过，但尚未检测到 R2 存储桶绑定';
                if (emptySub) emptySub.textContent = '请前往 Cloudflare Workers -> Settings -> Bindings 添加 R2 bucket 绑定 (名称: BUCKET)';
                unlockUI();
                renderSpace();
                toast('请绑定 R2 存储桶 BUCKET');
                return true;
            }

            // 4. 密码正确且 R2 已连接：加载真实云端图片
            allImages = Array.isArray(data.items) ? data.items : [];
            if (r2ConnStatus) {
                r2ConnStatus.textContent = `R2 CONNECTED · 已连接云端存储桶 (images · 共 ${allImages.length} 张影像)`;
            }
            const emptyTitle = document.querySelector('.empty-title');
            const emptySub = document.querySelector('.empty-sub');
            if (emptyTitle) emptyTitle.textContent = '当前 R2 存储桶暂无图片 · 点击或拖拽上传第一张作品';
            if (emptySub) emptySub.textContent = '支持 JPG · PNG · WebP · GIF · SVG 真实比例时间线归档';

            unlockUI();
            renderSpace();
            return true;
        } catch {
            if (!isLocalhost) {
                if (!isInitialAutoCheck) {
                    triggerLockShake('网络连接失败，请稍后重试');
                }
                return false;
            }
            isR2Connected = false;
            if (!passwordAttempt) return false;
            adminToken = passwordAttempt;
            localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
            allImages = loadLocalItems();
            unlockUI();
            renderSpace();
            return true;
        }
    }

    lockForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (lockInput?.value || '').trim();
        if (!val) {
            triggerLockShake('请输入访问密码 (PLEASE ENTER PASSWORD)');
            return;
        }
        if (lockError) lockError.textContent = 'VERIFYING...';
        await tryUnlockAndLoad(val, false);
    });

    /* =========================================================
       4. 仿 iPhone 相册缩略图尺寸调节器 (Thumbnail Zoom Scaler)
          - 桌面端 1..5 档 -> [7, 5, 4, 3, 2] 列
          - 手机端 1..4 档 -> [5, 3, 2, 1] 列 (支持底部 -/+ 按钮与双指捏合缩放)
          - 密集小图档位自动开启 .zoom-dense 隐藏底部标题，宛如 iOS 相册日/月视图
    ========================================================= */
    const DESKTOP_COLS_MAP = { 1: 7, 2: 5, 3: 4, 4: 3, 5: 2 };
    const MOBILE_COLS_MAP = { 1: 5, 2: 3, 3: 2, 4: 1 };

    const zoomSlider = document.getElementById('zoom-slider');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const mobZoomOut = document.getElementById('mob-zoom-out');
    const mobZoomIn = document.getElementById('mob-zoom-in');
    const mobZoomLabel = document.getElementById('mob-zoom-label');

    function isMobileViewport() {
        return window.innerWidth <= 820;
    }

    function getColumnCount() {
        if (isMobileViewport()) {
            return MOBILE_COLS_MAP[mobileZoomLevel] || 2;
        }
        return DESKTOP_COLS_MAP[desktopZoomLevel] || 4;
    }

    function syncZoomUI() {
        const cols = getColumnCount();
        const mobile = isMobileViewport();

        if (zoomSlider) {
            zoomSlider.value = String(desktopZoomLevel);
        }
        if (mobZoomLabel) {
            mobZoomLabel.textContent = `${cols}列`;
        }

        // 当列数较多（手机 >= 3 列，桌面 >= 5 列）时开启仿 iPhone 相册紧凑无字模式
        const isDense = mobile ? cols >= 3 : cols >= 5;
        document.body.classList.toggle('zoom-dense', isDense);
    }

    function applyZoomChange(newLevel, isMobile) {
        if (isMobile) {
            mobileZoomLevel = Math.min(4, Math.max(1, newLevel));
            localStorage.setItem(STORAGE_KEYS.ZOOM_MOBILE, String(mobileZoomLevel));
        } else {
            desktopZoomLevel = Math.min(5, Math.max(1, newLevel));
            localStorage.setItem(STORAGE_KEYS.ZOOM_DESKTOP, String(desktopZoomLevel));
        }
        syncZoomUI();
        renderSpace();
    }

    zoomSlider?.addEventListener('input', (e) => {
        applyZoomChange(parseInt(e.target.value, 10), false);
    });
    btnZoomOut?.addEventListener('click', () => {
        applyZoomChange(desktopZoomLevel - 1, false);
    });
    btnZoomIn?.addEventListener('click', () => {
        applyZoomChange(desktopZoomLevel + 1, false);
    });
    mobZoomOut?.addEventListener('click', () => {
        applyZoomChange(mobileZoomLevel - 1, true);
    });
    mobZoomIn?.addEventListener('click', () => {
        applyZoomChange(mobileZoomLevel + 1, true);
    });

    // 移动端画布支持仿 iPhone 相册双指捏合缩放 (Pinch-to-Zoom Grid)
    let pinchStartDist = 0;
    let pinchTriggered = false;
    const spaceMainEl = document.getElementById('space-main');

    spaceMainEl?.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchStartDist = Math.hypot(dx, dy);
            pinchTriggered = false;
        }
    }, { passive: true });

    spaceMainEl?.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchStartDist > 0 && !pinchTriggered) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const delta = dist - pinchStartDist;
            if (Math.abs(delta) > 42) {
                pinchTriggered = true;
                if (delta > 0) {
                    // 双指张开 -> 放大缩略图
                    applyZoomChange(mobileZoomLevel + 1, true);
                } else {
                    // 双指捏合 -> 缩小缩略图（更多列）
                    applyZoomChange(mobileZoomLevel - 1, true);
                }
            }
        }
    }, { passive: true });

    /* =========================================================
       5. 彩色分类标签、搜索与时间线真实比例瀑布流 (Timeline + Masonry)
    ========================================================= */
    const folderTabsEl = document.getElementById('folder-tabs');
    const batchMoveSelect = document.getElementById('batch-move-select');
    const timelineStreamEl = document.getElementById('timeline-stream');
    const emptyStageEl = document.getElementById('empty-stage');
    const storageStat = document.getElementById('storage-stat');
    const dropTargetHint = document.getElementById('drop-target-hint');

    function renderFolders() {
        if (!folderTabsEl) return;

        const folderCounts = new Map();
        allImages.forEach(item => {
            const f = item.folder || 'default';
            folderCounts.set(f, (folderCounts.get(f) || 0) + 1);
        });
        customFolders.forEach(f => {
            if (!folderCounts.has(f)) folderCounts.set(f, 0);
        });
        if (!folderCounts.has('default') && allImages.length === 0) {
            folderCounts.set('default', 0);
        }

        folderTabsEl.innerHTML = '';

        const allBtn = document.createElement('button');
        allBtn.className = `tab-item ${currentFolder === 'all' ? 'active' : ''}`;
        allBtn.style.setProperty('--cat-color', '#0a0a0a');
        allBtn.innerHTML = `
            <span class="tab-dot"></span>
            <span>ALL</span>
            <span class="tab-count">${allImages.length}</span>
        `;
        allBtn.addEventListener('click', () => {
            currentFolder = 'all';
            renderSpace();
        });
        folderTabsEl.appendChild(allBtn);

        const folderList = Array.from(folderCounts.keys());
        folderList.forEach(folder => {
            const color = getCategoryColor(folder);
            const count = folderCounts.get(folder) || 0;
            const btn = document.createElement('button');
            btn.className = `tab-item ${currentFolder === folder ? 'active' : ''}`;
            btn.style.setProperty('--cat-color', color);
            btn.innerHTML = `
                <span class="tab-dot"></span>
                <span>${folder.toUpperCase()}</span>
                <span class="tab-count">${count}</span>
            `;
            btn.addEventListener('click', () => {
                currentFolder = folder;
                renderSpace();
            });
            folderTabsEl.appendChild(btn);
        });

        if (batchMoveSelect) {
            batchMoveSelect.innerHTML = `<option value="">MOVE TO 移动分类至...</option>`;
            folderList.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `→ ${f.toUpperCase()}`;
                batchMoveSelect.appendChild(opt);
            });
            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = '+ 新建分类并移动...';
            batchMoveSelect.appendChild(newOpt);
        }

        if (dropTargetHint) {
            const target = currentFolder === 'all' ? 'default' : currentFolder;
            dropTargetHint.textContent = `松开鼠标上传至 [${target.toUpperCase()}]`;
        }
    }

    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
        const name = prompt('新建分类名称 (例如: 2026, street, blog, portrait):');
        if (!name) return;
        const clean = name.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-');
        if (!clean) return;
        customFolders.add(clean);
        currentFolder = clean;
        renderSpace();
        toast(`CREATED [${clean.toUpperCase()}]`);
    });

    document.getElementById('search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderSpace();
    });

    function renderSpace() {
        if (!isUnlocked) return;
        syncZoomUI();
        updateStorageQuotaUI();
        renderFolders();

        // 1. 按上传时间从新到旧严格排序
        allImages.sort((a, b) => new Date(b.uploaded || 0).getTime() - new Date(a.uploaded || 0).getTime());

        // 2. 筛选分类与搜索词
        filteredImages = allImages.filter(item => {
            const f = item.folder || 'default';
            if (currentFolder !== 'all' && f !== currentFolder) return false;
            if (!searchQuery) return true;
            const hay = [item.title, item.originalName, item.key, item.folder, item.exif?.camera].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(searchQuery);
        });

        if (storageStat) {
            storageStat.textContent = String(filteredImages.length);
        }

        if (!timelineStreamEl || !emptyStageEl) return;

        if (filteredImages.length === 0) {
            timelineStreamEl.innerHTML = '';
            emptyStageEl.hidden = false;
            return;
        }

        emptyStageEl.hidden = true;
        timelineStreamEl.innerHTML = '';

        // 3. 按日期分组构建时间线 (Chronological Timeline Grouping)
        const dayGroups = new Map();
        filteredImages.forEach((item, globalFilteredIdx) => {
            const dInfo = formatDateHeading(item.uploaded);
            if (!dayGroups.has(dInfo.key)) {
                dayGroups.set(dInfo.key, {
                    ...dInfo,
                    entries: []
                });
            }
            dayGroups.get(dInfo.key).entries.push({ item, globalFilteredIdx });
        });

        const numCols = getColumnCount();

        dayGroups.forEach((group) => {
            const section = document.createElement('section');
            section.className = 'timeline-section';

            const dayBytes = group.entries.reduce((acc, e) => acc + (Number(e.item.size) || 0), 0);

            section.innerHTML = `
                <div class="timeline-header">
                    <div class="timeline-date-group">
                        <span class="timeline-dot"></span>
                        <span class="timeline-date-title">${group.title}</span>
                        <span class="timeline-date-sub">${group.sub}</span>
                    </div>
                    <div class="timeline-meta-right">
                        <span>${group.entries.length} ITEMS · ${formatBytes(dayBytes)}</span>
                        <button type="button" class="timeline-select-day-btn">全选当天</button>
                    </div>
                </div>
                <div class="masonry-board" style="grid-template-columns: repeat(${numCols}, 1fr);"></div>
            `;

            // 点击“全选当天”快速勾选或取消当天所有照片
            const selectDayBtn = section.querySelector('.timeline-select-day-btn');
            selectDayBtn.addEventListener('click', () => {
                const allDaySelected = group.entries.every(e => selectedKeys.has(e.item.key));
                group.entries.forEach(({ item }) => {
                    if (allDaySelected) selectedKeys.delete(item.key);
                    else selectedKeys.add(item.key);
                    updateSelectionCardDOM(item.key);
                });
                syncBatchUI();
            });

            const board = section.querySelector('.masonry-board');
            const colEls = [];
            const colHeights = new Array(numCols).fill(0);

            for (let c = 0; c < numCols; c++) {
                const colDiv = document.createElement('div');
                colDiv.className = 'masonry-column';
                board.appendChild(colDiv);
                colEls.push(colDiv);
            }

            group.entries.forEach(({ item, globalFilteredIdx }) => {
                let shortestCol = 0;
                for (let c = 1; c < numCols; c++) {
                    if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
                }

                const w = Number(item.width) || 0;
                const h = Number(item.height) || 0;
                const aspect = (w > 0 && h > 0) ? (w / h) : 1.42;
                colHeights[shortestCol] += 1 / aspect;

                const card = document.createElement('div');
                const isSelected = selectedKeys.has(item.key);
                card.className = `photo-item ${isSelected ? 'selected' : ''}`;
                card.dataset.key = item.key;

                const folderName = item.folder || 'default';
                const catColor = getCategoryColor(folderName);
                const name = item.title || item.originalName || item.key.split('/').pop();
                const info = (w && h) ? `${w}×${h}` : formatBytes(item.size);
                const fullUrl = getFullUrl(item);
                const thumbUrl = getFastThumbUrl(item);

                const aspectStyle = (w > 0 && h > 0) ? `style="aspect-ratio: ${w} / ${h};"` : '';

                card.innerHTML = `
                    <div class="photo-thumb-wrap" ${aspectStyle}>
                        <button type="button" class="thumb-check" title="勾选">${isSelected ? '✓' : ''}</button>
                        <img src="${thumbUrl}" alt="${name}" loading="lazy" decoding="async">
                        <button type="button" class="thumb-copy-btn" title="复制原图直链">COPY</button>
                    </div>
                    <div class="photo-caption">
                        <div class="caption-left">
                            <span class="cat-badge" style="--cat-color: ${catColor}" title="点击筛选 ${folderName}">
                                <span class="cat-badge-dot"></span>
                                <span>${folderName}</span>
                            </span>
                            <span class="caption-name">${name}</span>
                        </div>
                        <span class="caption-info">${info}</span>
                    </div>
                `;

                const thumbWrap = card.querySelector('.photo-thumb-wrap');
                const imgEl = card.querySelector('img');
                const infoSpan = card.querySelector('.caption-info');

                imgEl.onload = () => {
                    if ((!item.width || !item.height) && imgEl.naturalWidth && imgEl.naturalHeight) {
                        item.width = imgEl.naturalWidth;
                        item.height = imgEl.naturalHeight;
                        if (infoSpan) infoSpan.textContent = `${item.width}×${item.height}`;
                    }
                };

                card.querySelector('.cat-badge').addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentFolder = folderName;
                    renderSpace();
                });

                card.querySelector('.thumb-check').addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleSelection(item.key);
                });

                card.querySelector('.thumb-copy-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyText(fullUrl, 'URL');
                });

                thumbWrap.addEventListener('click', () => {
                    if (isBatchMode || selectedKeys.size > 0) {
                        toggleSelection(item.key);
                    } else {
                        openViewer(globalFilteredIdx, imgEl.currentSrc || thumbUrl);
                    }
                });

                colEls[shortestCol].appendChild(card);
            });

            timelineStreamEl.appendChild(section);
        });
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isUnlocked) renderSpace();
        }, 150);
    });

    /* =========================================================
       6. 批量管理工具 (Batch Management Suite)
    ========================================================= */
    const btnBatchToggle = document.getElementById('btn-batch-toggle');
    const mobBtnBatch = document.getElementById('mob-btn-batch');
    const selectionDock = document.getElementById('selection-dock');
    const selCountEl = document.getElementById('sel-count');

    function updateSelectionCardDOM(key) {
        const card = timelineStreamEl?.querySelector(`.photo-item[data-key="${CSS.escape(key)}"]`);
        if (!card) return;
        const isSel = selectedKeys.has(key);
        card.classList.toggle('selected', isSel);
        const chk = card.querySelector('.thumb-check');
        if (chk) chk.textContent = isSel ? '✓' : '';
    }

    function syncBatchUI() {
        const count = selectedKeys.size;
        const active = isBatchMode || count > 0;
        document.body.classList.toggle('batch-active', active);
        btnBatchToggle?.classList.toggle('active', active);
        mobBtnBatch?.classList.toggle('active', active);
        if (mobBtnBatch) mobBtnBatch.textContent = active ? '完成' : '多选';
        if (selectionDock) selectionDock.hidden = !active;
        if (selCountEl) selCountEl.textContent = `${count} SELECTED`;
    }

    function toggleSelection(key) {
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
        updateSelectionCardDOM(key);
        syncBatchUI();
    }

    function clearBatchMode() {
        isBatchMode = false;
        selectedKeys.clear();
        syncBatchUI();
        renderSpace();
    }

    function handleToggleBatchMode() {
        if (isBatchMode || selectedKeys.size > 0) {
            clearBatchMode();
        } else {
            isBatchMode = true;
            syncBatchUI();
            toast('BATCH MODE · 点击任意图片即可多选');
        }
    }

    btnBatchToggle?.addEventListener('click', handleToggleBatchMode);
    mobBtnBatch?.addEventListener('click', handleToggleBatchMode);

    document.getElementById('btn-sel-all')?.addEventListener('click', () => {
        const allSelected = filteredImages.every(i => selectedKeys.has(i.key));
        filteredImages.forEach(i => {
            if (allSelected) selectedKeys.delete(i.key);
            else selectedKeys.add(i.key);
            updateSelectionCardDOM(i.key);
        });
        syncBatchUI();
    });

    document.getElementById('btn-sel-invert')?.addEventListener('click', () => {
        filteredImages.forEach(i => {
            if (selectedKeys.has(i.key)) selectedKeys.delete(i.key);
            else selectedKeys.add(i.key);
            updateSelectionCardDOM(i.key);
        });
        syncBatchUI();
    });

    batchMoveSelect?.addEventListener('change', async () => {
        let targetFolder = batchMoveSelect.value;
        batchMoveSelect.value = '';
        if (!targetFolder) return;

        const keys = Array.from(selectedKeys);
        if (keys.length === 0) return toast('请先勾选需要移动的图片');

        if (targetFolder === '__new__') {
            const input = prompt('输入新分类名称:');
            if (!input) return;
            targetFolder = input.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-');
            if (!targetFolder) return;
            customFolders.add(targetFolder);
        }

        toast(`MOVING ${keys.length} ITEMS TO [${targetFolder.toUpperCase()}]...`);

        if (isR2Connected) {
            const headers = { 'Content-Type': 'application/json' };
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            const res = await fetch('/api/images', {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ keys, folder: targetFolder })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                return toast(data.error || '批量移动失败');
            }
        }

        const keySet = new Set(keys);
        allImages.forEach(item => {
            if (keySet.has(item.key)) item.folder = targetFolder;
        });
        if (!isR2Connected) saveLocalItems();
        clearBatchMode();
        toast(`MOVED TO [${targetFolder.toUpperCase()}]`);
    });

    document.getElementById('btn-sel-copy-url')?.addEventListener('click', () => {
        const items = allImages.filter(i => selectedKeys.has(i.key));
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => getFullUrl(i)).join('\n'), `${items.length} URLS`);
    });

    document.getElementById('btn-sel-copy-md')?.addEventListener('click', () => {
        const items = allImages.filter(i => selectedKeys.has(i.key));
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => buildFormats(i).md).join('\n'), `${items.length} MARKDOWN`);
    });

    document.getElementById('btn-sel-copy-html')?.addEventListener('click', () => {
        const items = allImages.filter(i => selectedKeys.has(i.key));
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => buildFormats(i).html).join('\n'), `${items.length} HTML`);
    });

    document.getElementById('btn-sel-download')?.addEventListener('click', () => {
        const items = allImages.filter(i => selectedKeys.has(i.key));
        if (!items.length) return toast('请先选择图片');
        items.forEach((item, idx) => {
            setTimeout(() => {
                const a = document.createElement('a');
                a.href = getFullUrl(item);
                a.download = item.originalName || `image-${idx + 1}.jpg`;
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }, idx * 220);
        });
        toast(`DOWNLOADING ${items.length} FILES`);
    });

    document.getElementById('btn-sel-delete')?.addEventListener('click', async () => {
        const keys = Array.from(selectedKeys);
        if (!keys.length) return toast('请先勾选要删除的图片');
        if (!confirm(`确定永久删除选中的 ${keys.length} 张图片吗？`)) return;
        const ok = await deleteImages(keys);
        if (ok) clearBatchMode();
    });

    document.getElementById('btn-sel-clear')?.addEventListener('click', clearBatchMode);

    async function deleteImages(keys) {
        if (isR2Connected) {
            const headers = { 'Content-Type': 'application/json' };
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            const res = await fetch('/api/images', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ keys })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                toast(data.error || '删除失败');
                return false;
            }
        }
        const delSet = new Set(keys);
        allImages = allImages.filter(i => !delSet.has(i.key));
        if (!isR2Connected) saveLocalItems();
        renderSpace();
        toast(`DELETED ${keys.length} ITEMS`);
        return true;
    }

    /* =========================================================
       7. 极速双层上传引擎 (自动生成 1080px WebP 预览图 + 原图并发入库)
    ========================================================= */
    const fileInput = document.getElementById('file-input');
    const dropOverlay = document.getElementById('drop-overlay');
    const uploadRibbon = document.getElementById('upload-ribbon');
    const ribbonBar = document.getElementById('ribbon-bar');
    const ribbonText = document.getElementById('ribbon-text');
    const ribbonPercent = document.getElementById('ribbon-percent');

    document.getElementById('btn-upload')?.addEventListener('click', () => fileInput?.click());
    document.getElementById('mob-btn-upload')?.addEventListener('click', () => fileInput?.click());
    document.getElementById('empty-drop-trigger')?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
        if (e.target.files?.length) {
            uploadFiles(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
        if (!isUnlocked) return;
        if (e.dataTransfer?.types?.includes('Files')) {
            dragDepth++;
            dropOverlay?.classList.add('active');
        }
    });
    window.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropOverlay?.classList.remove('active');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDepth = 0;
        dropOverlay?.classList.remove('active');
        if (!isUnlocked) return;
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length) uploadFiles(files);
    });

    window.addEventListener('paste', (e) => {
        if (!isUnlocked) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length) uploadFiles(files);
    });

    async function parseExif(file) {
        if (!window.exifr) return {};
        try {
            const raw = await window.exifr.parse(file, {
                pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO']
            });
            if (!raw) return {};
            const camera = [raw.Make, raw.Model].filter(Boolean).join(' ').replace(/^(\S+)\s+\1/i, '$1').trim();
            const shutter = raw.ExposureTime
                ? (raw.ExposureTime < 1 ? `1/${Math.round(1 / raw.ExposureTime)}s` : `${raw.ExposureTime}s`)
                : '';
            return {
                camera: camera || '',
                lens: raw.LensModel || '',
                focal: raw.FocalLength ? `${Math.round(raw.FocalLength)}mm` : '',
                aperture: raw.FNumber ? `f/${Number(raw.FNumber).toFixed(1).replace(/\.0$/, '')}` : '',
                shutter,
                iso: raw.ISO ? String(raw.ISO) : ''
            };
        } catch {
            return {};
        }
    }

    async function prepareImageAndThumbnail(file) {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            const u = URL.createObjectURL(file);
            el.onload = () => { URL.revokeObjectURL(u); resolve(el); };
            el.onerror = reject;
            el.src = u;
        });

        let width = img.naturalWidth || 1920;
        let height = img.naturalHeight || 1080;

        // 生成 1080px 高清轻量 WebP 预览图 (~45KB)，既清晰又能让列表和弹窗做到 <16ms 零卡顿
        let thumbBlob = null;
        if (file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
            const thumbMax = 1080;
            let tw = width;
            let th = height;
            if (tw > thumbMax || th > thumbMax) {
                if (tw >= th) {
                    th = Math.round((th * thumbMax) / tw);
                    tw = thumbMax;
                } else {
                    tw = Math.round((tw * thumbMax) / th);
                    th = thumbMax;
                }
            }
            const tCanvas = document.createElement('canvas');
            tCanvas.width = tw;
            tCanvas.height = th;
            tCanvas.getContext('2d').drawImage(img, 0, 0, tw, th);
            thumbBlob = await new Promise(r => tCanvas.toBlob(r, 'image/webp', 0.82));
        }

        if (uploadMode === 'original' || file.type === 'image/svg+xml' || file.type === 'image/gif') {
            return { file, thumbBlob, width, height };
        }

        const maxEdge = uploadMode === 'webp-2k' ? 2560 : 3840;
        if (width > maxEdge || height > maxEdge) {
            if (width >= height) {
                height = Math.round((height * maxEdge) / width);
                width = maxEdge;
            } else {
                width = Math.round((width * maxEdge) / height);
                height = maxEdge;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.88));
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const out = new File([blob], `${baseName}.webp`, { type: 'image/webp' });
        return { file: out, thumbBlob, width, height };
    }

    async function uploadFiles(files) {
        const targetFolder = currentFolder === 'all' ? 'default' : currentFolder;
        if (uploadRibbon) uploadRibbon.hidden = false;

        let completed = 0;
        const total = files.length;

        for (const rawFile of files) {
            if (ribbonText) ribbonText.textContent = `Uploading ${rawFile.name} (${completed + 1}/${total})...`;
            const pct = Math.round(((completed + 0.25) / total) * 100);
            if (ribbonBar) ribbonBar.style.width = `${pct}%`;
            if (ribbonPercent) ribbonPercent.textContent = `${pct}%`;

            try {
                const [exif, { file, thumbBlob, width, height }] = await Promise.all([
                    parseExif(rawFile),
                    prepareImageAndThumbnail(rawFile)
                ]);

                let newItem = null;

                if (isR2Connected) {
                    const fd = new FormData();
                    fd.append('file', file);
                    if (thumbBlob) {
                        fd.append('thumb', new File([thumbBlob], 'thumb.webp', { type: 'image/webp' }));
                    }
                    fd.append('folder', targetFolder);
                    fd.append('customName', rawFile.name.replace(/\.[^/.]+$/, ''));
                    fd.append('title', rawFile.name);
                    fd.append('width', String(width));
                    fd.append('height', String(height));
                    fd.append('exif', JSON.stringify(exif));

                    const headers = {};
                    if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;

                    const res = await fetch('/api/images', { method: 'POST', headers, body: fd });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                        throw new Error(data.error || 'Upload failed');
                    }
                    newItem = data.item;
                } else {
                    const dataUrl = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onload = () => r(reader.result);
                        reader.readAsDataURL(thumbBlob || file);
                    });
                    newItem = {
                        key: `${targetFolder}/${Date.now()}-${file.name}`,
                        url: dataUrl,
                        thumbUrl: dataUrl,
                        size: file.size,
                        uploaded: new Date().toISOString(),
                        folder: targetFolder,
                        originalName: file.name,
                        title: rawFile.name,
                        width,
                        height,
                        isDemo: true,
                        exif
                    };
                }

                allImages.unshift(newItem);
                if (!isR2Connected) saveLocalItems();
                completed++;
                const donePct = Math.round((completed / total) * 100);
                if (ribbonBar) ribbonBar.style.width = `${donePct}%`;
                if (ribbonPercent) ribbonPercent.textContent = `${donePct}%`;
                renderSpace();
            } catch (err) {
                toast(err.message || '上传失败');
            }
        }

        if (completed > 0) {
            toast(`UPLOADED ${completed} ${completed === 1 ? 'IMAGE' : 'IMAGES'}`);
        }
        setTimeout(() => {
            if (uploadRibbon) uploadRibbon.hidden = true;
            if (ribbonBar) ribbonBar.style.width = '0%';
        }, 500);
    }

    /* =========================================================
       8. 零卡顿极速详情检视层 (Zero-Jank Instant Viewer + Mobile Touch Swipe)
    ========================================================= */
    const viewerModal = document.getElementById('viewer-modal');
    const viewerStage = document.getElementById('viewer-stage');
    const viewerImg = document.getElementById('viewer-img');
    const btnLoadHd = document.getElementById('btn-load-hd');
    const metaTitleInput = document.getElementById('meta-title-input');
    const metaFolderInput = document.getElementById('meta-folder-input');
    const viewerFolderDot = document.getElementById('viewer-folder-dot');
    const exifBlock = document.getElementById('exif-block');
    const exifList = document.getElementById('exif-list');

    function openViewer(idx, alreadyDecodedSrc = null) {
        if (filteredImages.length === 0) return;
        activeViewerIdx = ((idx % filteredImages.length) + filteredImages.length) % filteredImages.length;
        populateViewer(alreadyDecodedSrc);
        viewerModal?.classList.add('open');
    }

    function closeViewer() {
        activeViewerIdx = -1;
        viewerModal?.classList.remove('open');
    }

    function populateViewer(alreadyDecodedSrc = null) {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;

        const fullUrl = getFullUrl(item);
        const fastThumb = alreadyDecodedSrc || getFastThumbUrl(item);
        const formats = buildFormats(item);

        if (viewerImg) {
            viewerImg.src = fastThumb;
        }

        if (btnLoadHd) {
            if (fullUrl && fullUrl !== fastThumb) {
                btnLoadHd.hidden = false;
                btnLoadHd.textContent = `LOAD ORIGINAL HD (${formatBytes(item.size)})`;
                btnLoadHd.disabled = false;
            } else {
                btnLoadHd.hidden = true;
            }
        }

        const folderName = item.folder || 'default';
        if (metaTitleInput) metaTitleInput.value = item.title || item.originalName || '';
        if (metaFolderInput) metaFolderInput.value = folderName;
        if (viewerFolderDot) viewerFolderDot.style.background = getCategoryColor(folderName);

        document.getElementById('stat-dimensions').textContent = (item.width && item.height) ? `${item.width} × ${item.height}` : 'ORIGINAL';
        document.getElementById('stat-size').textContent = formatBytes(item.size);
        document.getElementById('stat-date').textContent = (item.uploaded || '').slice(0, 10);

        document.getElementById('val-url').textContent = formats.url;
        document.getElementById('val-md').textContent = formats.md;
        document.getElementById('val-html').textContent = formats.html;

        const dl = document.getElementById('btn-download');
        if (dl) {
            dl.href = fullUrl;
            dl.download = item.originalName || 'image.jpg';
        }

        const ex = item.exif || {};
        const entries = [
            ['CAMERA', ex.camera],
            ['LENS', ex.lens],
            ['FOCAL', ex.focal],
            ['APERTURE', ex.aperture],
            ['SHUTTER', ex.shutter],
            ['ISO', ex.iso]
        ].filter(([, v]) => Boolean(v));

        if (entries.length > 0 && exifBlock && exifList) {
            exifBlock.hidden = false;
            exifList.innerHTML = entries.map(([k, v]) => `
                <div class="exif-pair">
                    <span class="exif-k">${k}</span>
                    <span class="exif-v">${v}</span>
                </div>
            `).join('');
        } else if (exifBlock) {
            exifBlock.hidden = true;
        }
    }

    btnLoadHd?.addEventListener('click', async () => {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;
        const fullUrl = getFullUrl(item);
        btnLoadHd.textContent = 'DECODING HD...';
        btnLoadHd.disabled = true;

        try {
            const hd = new Image();
            hd.src = fullUrl;
            if (typeof hd.decode === 'function') {
                await hd.decode();
            } else {
                await new Promise((res, rej) => { hd.onload = res; hd.onerror = rej; });
            }
            if (viewerImg && filteredImages[activeViewerIdx] === item) {
                viewerImg.src = fullUrl;
                btnLoadHd.hidden = true;
            }
        } catch {
            btnLoadHd.textContent = 'HD LOAD FAILED';
        }
    });

    metaFolderInput?.addEventListener('input', () => {
        if (viewerFolderDot) {
            viewerFolderDot.style.background = getCategoryColor(metaFolderInput.value);
        }
    });

    document.querySelectorAll('.copy-line').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = filteredImages[activeViewerIdx];
            if (!item) return;
            const formats = buildFormats(item);
            const fmt = btn.dataset.format;
            if (fmt === 'url') copyText(formats.url, 'URL');
            if (fmt === 'md') copyText(formats.md, 'MARKDOWN');
            if (fmt === 'html') copyText(formats.html, 'HTML');
        });
    });

    document.getElementById('btn-save-meta')?.addEventListener('click', async () => {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;
        const newTitle = metaTitleInput.value.trim();
        const newFolder = metaFolderInput.value.trim() || 'default';

        if (isR2Connected && !item.isDemo) {
            const headers = { 'Content-Type': 'application/json' };
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            const res = await fetch('/api/images', {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ key: item.key, title: newTitle, folder: newFolder })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                return toast(data.error || '保存失败');
            }
        }

        item.title = newTitle;
        item.folder = newFolder;
        if (!isR2Connected) saveLocalItems();
        populateViewer();
        renderSpace();
        toast('SAVED');
    });

    document.getElementById('btn-delete-single')?.addEventListener('click', async () => {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;
        if (!confirm(`确定删除 [${item.title || item.originalName}] 吗？`)) return;
        const ok = await deleteImages([item.key]);
        if (ok) closeViewer();
    });

    function showPrevViewerImage() {
        if (filteredImages.length === 0) return;
        activeViewerIdx = (activeViewerIdx - 1 + filteredImages.length) % filteredImages.length;
        populateViewer();
    }

    function showNextViewerImage() {
        if (filteredImages.length === 0) return;
        activeViewerIdx = (activeViewerIdx + 1) % filteredImages.length;
        populateViewer();
    }

    document.getElementById('viewer-prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showPrevViewerImage();
    });
    document.getElementById('viewer-next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showNextViewerImage();
    });
    document.getElementById('viewer-close')?.addEventListener('click', closeViewer);
    document.getElementById('mobile-viewer-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeViewer();
    });
    viewerStage?.addEventListener('click', (e) => {
        if (e.target.id === 'viewer-stage') closeViewer();
    });

    // 移动端看图区左右滑动手势切换上下张
    let swipeStartX = 0;
    let swipeStartY = 0;
    viewerStage?.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            swipeStartX = e.touches[0].clientX;
            swipeStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    viewerStage?.addEventListener('touchend', (e) => {
        if (!swipeStartX || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        const dy = e.changedTouches[0].clientY - swipeStartY;
        swipeStartX = 0;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (dx > 0) showPrevViewerImage();
            else showNextViewerImage();
        }
    }, { passive: true });

    /* =========================================================
       9. 空间设置与一键锁屏弹窗
    ========================================================= */
    const settingsModal = document.getElementById('settings-modal');
    const selectUploadMode = document.getElementById('select-upload-mode');
    const inputCustomDomain = document.getElementById('input-custom-domain');
    const inputNewPassword = document.getElementById('input-new-password');

    function openSettings() {
        updateStorageQuotaUI();
        if (selectUploadMode) selectUploadMode.value = uploadMode;
        if (inputCustomDomain) inputCustomDomain.value = customDomain;
        if (inputNewPassword) inputNewPassword.value = '';
        settingsModal?.classList.add('open');
    }

    function closeSettings() {
        settingsModal?.classList.remove('open');
    }

    document.getElementById('btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('settings-close')?.addEventListener('click', closeSettings);
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
        uploadMode = selectUploadMode?.value || 'original';
        customDomain = (inputCustomDomain?.value || '').trim();
        localStorage.setItem(STORAGE_KEYS.UPLOAD_MODE, uploadMode);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DOMAIN, customDomain);

        const nextPwd = (inputNewPassword?.value || '').trim();
        if (nextPwd && isR2Connected) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
                const res = await fetch('/api/images', {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ action: 'changePassword', newPassword: nextPwd })
                });
                const data = await res.json();
                if (!res.ok || !data.ok) {
                    toast(data.error || '密码修改失败');
                    return;
                }
                adminToken = nextPwd;
                localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
                if (inputNewPassword) inputNewPassword.value = '';
                toast('密码已更新并加密保存至 R2');
            } catch {
                toast('网络错误，密码修改失败');
                return;
            }
        } else {
            toast('SETTINGS SAVED');
        }

        closeSettings();
        renderSpace();
    });

    document.getElementById('btn-lock-now')?.addEventListener('click', () => {
        adminToken = '';
        localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
        if (lockInput) lockInput.value = '';
        closeSettings();
        showLockUI();
    });

    window.addEventListener('keydown', (e) => {
        if (!isUnlocked) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') {
            if (activeViewerIdx >= 0) closeViewer();
            else if (settingsModal?.classList.contains('open')) closeSettings();
            else if (isBatchMode || selectedKeys.size > 0) clearBatchMode();
        } else if (activeViewerIdx >= 0) {
            if (e.key === 'ArrowLeft') showPrevViewerImage();
            if (e.key === 'ArrowRight') showNextViewerImage();
        } else if (e.key === 'b' || e.key === 'B') {
            handleToggleBatchMode();
        }
    });

    syncZoomUI();
    probeServerStatus();

    if (adminToken) {
        tryUnlockAndLoad(adminToken, true);
    } else {
        showLockUI();
    }
});
