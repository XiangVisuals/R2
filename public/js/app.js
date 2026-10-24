/**
 * IMG (v5.0 Frosted Glass Vision · 6-Layer Mainland China Acceleration Engine)
 *
 * 核心特性:
 * 1. 极简 IMG 品牌与全套 VisionOS 悬浮毛玻璃光影美学 (无冗余文案、统一 14px/10px/7px 黄金圆角)
 * 2. 中国大陆 6 重极速加载引擎:
 *    - Service Worker 本地磁盘强缓存 (/sw.js) 二次打开 0ms
 *    - LocalStorage 云端快照 SWR 瞬时渲染 (<20ms 首屏秒开，后台静默同步)
 *    - 视口优先 3 并发智能加载队列 (IntersectionObserver 杜绝跨境多图并发 TCP 拥塞假死)
 *    - 600px 极速 WebP 缩略图 (~15KB) + 24px 内联 LQIP 模糊占位 (0ms 瞬时成像)
 *    - 针对历史未生成缩略图的大图支持后台自动回填 + 设置面板一键全量生成极速缩略图 + 全球 CDN WebP 代理兜底
 * 3. 网站启动序幕动画 (#site-loader) + 光学星环充能密码锁 (#lock-screen)
 * 4. 全功能分类管理 (#category-modal / #quick-cat-popover / 拖拽照片到顶部分类标签归档)
 */

document.addEventListener("DOMContentLoaded", () => {
    const STORAGE_KEYS = {
        ADMIN_TOKEN: 'xiang_r2_token',
        CUSTOM_DOMAIN: 'xiang_r2_domain',
        UPLOAD_MODE: 'xiang_r2_upload_mode',
        CHINA_CDN_MODE: 'xiang_r2_china_cdn_mode',
        HDR_MODE: 'xiang_r2_hdr_mode',
        LOCAL_ITEMS: 'xiang_r2_local_items',
        CLOUD_SNAPSHOT: 'xiang_r2_cloud_snapshot_v5',
        ZOOM_DESKTOP: 'xiang_r2_zoom_desktop',
        ZOOM_MOBILE: 'xiang_r2_zoom_mobile',
        CATEGORIES: 'xiang_r2_categories_v2'
    };

    // 注册 Service Worker 持久缓存静态资源与 /raw/ 图片直链，二次打开 0ms
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Cloudflare R2 免费存储额度 = 10 GB
    const R2_FREE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

    const isLocalhost = (
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.protocol === 'file:'
    );

    let adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN) || '';
    let customDomain = localStorage.getItem(STORAGE_KEYS.CUSTOM_DOMAIN) || '';
    let uploadMode = localStorage.getItem(STORAGE_KEYS.UPLOAD_MODE) || 'original';
    let chinaCdnMode = localStorage.getItem(STORAGE_KEYS.CHINA_CDN_MODE) || 'smart-queue';
    let isHdrEnabled = localStorage.getItem(STORAGE_KEYS.HDR_MODE) !== '0';

    const btnHdrToggle = document.getElementById('btn-hdr-toggle');
    function syncHdrModeUI() {
        document.body.classList.toggle('hdr-enabled', isHdrEnabled);
        btnHdrToggle?.classList.toggle('active', isHdrEnabled);
    }
    syncHdrModeUI();

    btnHdrToggle?.addEventListener('click', () => {
        isHdrEnabled = !isHdrEnabled;
        localStorage.setItem(STORAGE_KEYS.HDR_MODE, isHdrEnabled ? '1' : '0');
        syncHdrModeUI();
        toast(isHdrEnabled ? 'HDR 广色域高动态渲染已开启' : 'HDR 渲染已关闭');
        if (activeViewerIdx >= 0) {
            populateViewer();
        }
    });

    // 缩略图档位：桌面端 1..5 (对应 7, 5, 4, 3, 2 列)，手机端 1..4 (对应 5, 3, 2, 1 列)
    let desktopZoomLevel = Math.min(5, Math.max(1, parseInt(localStorage.getItem(STORAGE_KEYS.ZOOM_DESKTOP) || '3', 10)));
    let mobileZoomLevel = Math.min(4, Math.max(1, parseInt(localStorage.getItem(STORAGE_KEYS.ZOOM_MOBILE) || '3', 10)));

    let isR2Connected = false;
    let isUnlocked = false;
    let allImages = [];
    let filteredImages = [];
    let currentFolder = 'all';
    let searchQuery = '';
    let isBatchMode = false;
    let selectedKeys = new Set();
    let activeViewerIdx = -1;

    /* =========================================================
       0-A. 网站启动序幕加载动画控制 (Site Boot Loader)
    ========================================================= */
    const siteLoaderEl = document.getElementById('site-loader');
    const siteLoaderBar = document.getElementById('site-loader-bar');
    const siteLoaderText = document.getElementById('site-loader-text');
    let siteLoaderDismissed = false;

    function updateSiteLoader(pct, text) {
        if (siteLoaderDismissed) return;
        if (siteLoaderBar) siteLoaderBar.style.width = `${pct}%`;
        if (text && siteLoaderText) siteLoaderText.textContent = text;
    }

    function dismissSiteLoader(delayMs = 180) {
        if (siteLoaderDismissed) return;
        siteLoaderDismissed = true;
        if (siteLoaderBar) siteLoaderBar.style.width = '100%';
        setTimeout(() => {
            siteLoaderEl?.classList.add('fade-out');
        }, delayMs);
    }

    updateSiteLoader(45, 'LOADING');

    /* =========================================================
       0-B. 画廊分类与色彩系统 (Category & Color System)
    ========================================================= */
    const DYNAMIC_PALETTE = [
        '#2563eb', // 宝石蓝
        '#059669', // 翡翠绿
        '#d97706', // 琥珀金
        '#7c3aed', // 鸢尾紫
        '#e11d48', // 胭脂红
        '#0891b2', // 青瓷蓝
        '#4f46e5', // 靛青色
        '#ea580c', // 丹霞橙
        '#0d9488', // 松石绿
        '#475569'  // 岩石灰
    ];

    const PRESET_FOLDER_COLORS = {
        all: '#0f172a',
        portfolio: '#2563eb',
        street: '#d97706',
        blog: '#059669',
        portrait: '#e11d48',
        film: '#0891b2',
        travel: '#ea580c'
    };

    const PRESET_FOLDER_LABELS = {
        all: '全部'
    };

    function normalizeFolder(f) {
        const clean = (f || '').trim();
        return (clean === 'default' || clean === 'all' || clean === 'uploads') ? '' : clean;
    }

    // 存储用户自定义分类及其专属颜色: Map<folderName, { name, color }>
    const categoryMetaMap = new Map();

    function loadLocalCategories() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
            if (!raw) return;
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                list.forEach(c => {
                    const name = normalizeFolder(c?.name);
                    if (name) {
                        categoryMetaMap.set(name, { name, color: c.color || '' });
                    }
                });
            }
        } catch {}
    }

    function saveLocalCategories() {
        try {
            const arr = Array.from(categoryMetaMap.values()).filter(c => normalizeFolder(c?.name));
            localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(arr));
        } catch {}
    }

    async function syncCategoriesToCloud() {
        saveLocalCategories();
        if (!isR2Connected) return;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            await fetch('/api/images', {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    action: 'saveCategories',
                    categories: Array.from(categoryMetaMap.values())
                })
            });
        } catch {}
    }

    loadLocalCategories();

    function formatFolderDisplayName(folderName) {
        const clean = normalizeFolder(folderName);
        if (!clean) return '全部';
        if (PRESET_FOLDER_LABELS[clean]) return PRESET_FOLDER_LABELS[clean];
        return clean;
    }

    function getCategoryColor(folderName) {
        const clean = normalizeFolder(folderName);
        if (!clean || clean === 'all') return '#64748b';
        const custom = categoryMetaMap.get(clean);
        if (custom && custom.color) return custom.color;
        const lower = clean.toLowerCase();
        if (PRESET_FOLDER_COLORS[lower]) return PRESET_FOLDER_COLORS[lower];
        let hash = 0;
        for (let i = 0; i < clean.length; i++) {
            hash = clean.charCodeAt(i) + ((hash << 5) - hash);
        }
        return DYNAMIC_PALETTE[Math.abs(hash) % DYNAMIC_PALETTE.length];
    }

    function getAllCategoryNames() {
        const set = new Set();
        categoryMetaMap.forEach((_, name) => {
            const clean = normalizeFolder(name);
            if (clean) set.add(clean);
        });
        allImages.forEach(item => {
            const clean = normalizeFolder(item.folder);
            if (clean) set.add(clean);
        });
        return Array.from(set);
    }

    // 本地云端快照缓存 (Stale-While-Revalidate 秒开核心)
    function saveCloudSnapshot(items) {
        try {
            localStorage.setItem(STORAGE_KEYS.CLOUD_SNAPSHOT, JSON.stringify({
                ts: Date.now(),
                items: items.slice(0, 300)
            }));
        } catch {}
    }

    function loadCloudSnapshot() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.CLOUD_SNAPSHOT);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.items)) return parsed.items;
        } catch {}
        return null;
    }

    const SEED_DEMO = [
        {
            key: "精选/IMG_0635.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/color/IMG_0635.jpg",
            size: 2845120,
            uploaded: "2026-10-23T10:30:00.000Z",
            folder: "精选",
            originalName: "IMG_0635.jpg",
            title: "山谷晨雾",
            width: 3840,
            height: 2560,
            isDemo: true,
            exif: { camera: "Canon EOS R5", lens: "RF 70-200mm F2.8", focal: "135mm", aperture: "f/4", shutter: "1/500s", iso: "160" }
        },
        {
            key: "精选/IMG_0801.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/line/IMG_0801.jpg",
            size: 1984000,
            uploaded: "2026-10-23T09:15:00.000Z",
            folder: "精选",
            originalName: "IMG_0801.jpg",
            title: "建筑光影",
            width: 3000,
            height: 4000,
            isDemo: true,
            exif: { camera: "Hasselblad X2D", lens: "XCD 55V", focal: "55mm", aperture: "f/5.6", shutter: "1/640s", iso: "64" }
        },
        {
            key: "街拍/IMG_2655.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/city/IMG_2655.jpg",
            size: 3120400,
            uploaded: "2026-10-21T14:20:00.000Z",
            folder: "街拍",
            originalName: "IMG_2655.jpg",
            title: "城市黄昏",
            width: 3600,
            height: 2400,
            isDemo: true,
            exif: { camera: "Canon EOS R5", lens: "RF 24-70mm F2.8", focal: "50mm", aperture: "f/8", shutter: "1/250s", iso: "100" }
        },
        {
            key: "胶片/IMG_2973.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/black/IMG_2973.jpg",
            size: 2450100,
            uploaded: "2026-10-18T18:00:00.000Z",
            folder: "胶片",
            originalName: "IMG_2973.jpg",
            title: "静谧海岸",
            width: 3840,
            height: 2560,
            isDemo: true,
            exif: { camera: "Leica M11", lens: "Summilux-M 35mm", focal: "35mm", aperture: "f/5.6", shutter: "1/1000s", iso: "125" }
        }
    ];

    /* =========================================================
       1. 工具函数与国内智能图片加速 URL 解析
    ========================================================= */
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDateHeading(isoStr) {
        if (!isoStr) return { key: '更早', title: '更早', sub: '' };
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return { key: '更早', title: '更早', sub: '' };

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateKey = `${yyyy}.${mm}.${dd}`;

        const now = new Date();
        const todayKey = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

        const yest = new Date(now);
        yest.setDate(now.getDate() - 1);
        const yestKey = `${yest.getFullYear()}.${String(yest.getMonth() + 1).padStart(2, '0')}.${String(yest.getDate()).padStart(2, '0')}`;

        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const wk = weekdays[d.getDay()];

        if (dateKey === todayKey) return { key: dateKey, title: dateKey, sub: `今天 · ${wk}` };
        if (dateKey === yestKey) return { key: dateKey, title: dateKey, sub: `昨天 · ${wk}` };
        return { key: dateKey, title: dateKey, sub: wk };
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

    async function copyText(text, label = '链接') {
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
        toast(`已复制${label}`);
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

    function getAbsoluteUrl(relativeOrFullUrl) {
        if (!relativeOrFullUrl) return '';
        if (/^https?:\/\//i.test(relativeOrFullUrl) || relativeOrFullUrl.startsWith('data:')) {
            return relativeOrFullUrl;
        }
        return `${location.origin}${relativeOrFullUrl.startsWith('/') ? '' : '/'}${relativeOrFullUrl}`;
    }

    // 获取极速缩略图地址：
    // 1) 若已有 R2 极速缩略图 (.thumbs/ ~15KB WebP)，直接走边缘节点缓存直连
    // 2) 若是尚未生成缩略图的历史大图且开启了 wsrv-cdn 模式，自动通过全球边缘压缩为 640px WebP (~18KB) 防止国内拉取数 MB 原图卡死
    function getFastThumbUrl(item, forceDirect = false) {
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
            return `${rawUrl}?x-oss-process=image/resize,l_800,limit_1/auto-orient,1/quality,q_82/format,webp`;
        }
        if (!forceDirect && chinaCdnMode === 'wsrv-cdn' && !item.isDemo && !isLocalhost && (Number(item.size) || 0) > 180 * 1024) {
            const abs = getAbsoluteUrl(rawUrl);
            return `https://wsrv.nl/?url=${encodeURIComponent(abs)}&w=640&q=78&output=webp`;
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
            quotaPillText.textContent = `${usedFormatted} / 10G`;
        }
        if (quotaMiniFill) {
            quotaMiniFill.style.width = `${Math.max(2, pct)}%`;
            quotaMiniFill.style.background = pct > 85 ? 'var(--danger)' : 'var(--ok)';
        }

        if (meterPct) meterPct.textContent = `${pct < 0.1 && totalUsedBytes > 0 ? '< 0.1' : pct.toFixed(1)}%`;
        if (meterUsedVal) meterUsedVal.textContent = `${usedFormatted} (${allImages.length})`;
        if (meterFreeVal) meterFreeVal.textContent = freeGB;

        const catBytesMap = new Map();
        allImages.forEach(item => {
            const f = normalizeFolder(item.folder);
            catBytesMap.set(f, (catBytesMap.get(f) || 0) + (Number(item.size) || 0));
        });

        if (meterBarMulti && meterCatBreakdown) {
            meterBarMulti.innerHTML = '';
            meterCatBreakdown.innerHTML = '';

            if (totalUsedBytes === 0) {
                meterCatBreakdown.innerHTML = `<span>10.00 GB 可用</span>`;
                return;
            }

            Array.from(catBytesMap.entries())
                .sort((a, b) => b[1] - a[1])
                .forEach(([folder, bytes]) => {
                    const color = getCategoryColor(folder);
                    const label = folder ? formatFolderDisplayName(folder) : '未分类';
                    const sharePct = Math.max(2, (bytes / totalUsedBytes) * 100);

                    const seg = document.createElement('div');
                    seg.className = 'meter-seg';
                    seg.style.width = `${sharePct}%`;
                    seg.style.background = color;
                    seg.title = `${label}: ${formatBytes(bytes)}`;
                    meterBarMulti.appendChild(seg);

                    const itemEl = document.createElement('div');
                    itemEl.className = 'breakdown-item';
                    itemEl.innerHTML = `
                        <span class="breakdown-dot" style="background:${color}"></span>
                        <span>${label} ${formatBytes(bytes)}</span>
                    `;
                    meterCatBreakdown.appendChild(itemEl);
                });
        }
    }

    document.getElementById('btn-quota-detail')?.addEventListener('click', () => openSettings());

    /* =========================================================
       3. 首屏重度光学毛玻璃门禁 (Deep Smoked Optical Frosted Glass Vault)
    ========================================================= */
    const lockScreen = document.getElementById('lock-screen');
    const lockForm = document.getElementById('lock-form');
    const lockInput = document.getElementById('lock-password-input');
    const lockInputGroup = document.getElementById('lock-input-group');
    const lockInputLaser = document.getElementById('lock-input-laser');
    const lockToggleVisBtn = document.getElementById('lock-toggle-vis');
    const lockSubmitBtn = document.getElementById('lock-submit-btn');
    const lockEmblemStage = document.getElementById('lock-emblem-stage');
    const lockRippleRing = document.getElementById('lock-ripple-ring');
    const lockMark = document.getElementById('lock-mark');
    const lockError = document.getElementById('lock-error');
    const skeletonStageEl = document.getElementById('skeleton-stage');

    let typingBumpTimer = null;
    let autoVerifyTimer = null;
    let serverAuthHash = '';
    let serverNeedsFirstSetup = false;
    let isAutoUnlocking = false;

    async function sha256HexBrowser(text) {
        if (!window.crypto?.subtle) return '';
        const data = new TextEncoder().encode(String(text));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    lockToggleVisBtn?.addEventListener('click', () => {
        if (!lockInput) return;
        const isPwd = lockInput.type === 'password';
        lockInput.type = isPwd ? 'text' : 'password';
        lockToggleVisBtn.classList.toggle('active', isPwd);
        lockInput.focus();
    });

    function triggerKeystrokeRipple() {
        if (!lockRippleRing) return;
        lockRippleRing.classList.remove('ripple-active');
        void lockRippleRing.offsetWidth;
        lockRippleRing.classList.add('ripple-active');
    }

    function syncLockTypingVisualizer() {
        const val = lockInput?.value || '';
        const len = val.length;
        lockMark?.classList.toggle('has-input', len > 0);
        lockInputGroup?.classList.toggle('has-val', len > 0);

        const fillPct = Math.min(100, (len / 10) * 100);
        if (lockInputLaser) {
            lockInputLaser.style.width = `${fillPct}%`;
        }
    }

    lockInput?.addEventListener('input', async () => {
        if (isUnlocked || isAutoUnlocking) return;
        if (lockError && !lockSubmitBtn?.classList.contains('verifying')) {
            lockError.textContent = '';
            lockError.classList.remove('ok-msg');
        }
        lockEmblemStage?.classList.remove('unlocked-state');
        const rawVal = (lockInput?.value || '').trim();

        syncLockTypingVisualizer();
        triggerKeystrokeRipple();

        lockMark?.classList.add('typing-bump');
        lockInputGroup?.classList.add('typing-pulse');
        clearTimeout(typingBumpTimer);
        typingBumpTimer = setTimeout(() => {
            lockMark?.classList.remove('typing-bump');
            lockInputGroup?.classList.remove('typing-pulse');
        }, 180);

        clearTimeout(autoVerifyTimer);
        if (!rawVal || serverNeedsFirstSetup) return;

        // 1. 若已拿到云端密码 SHA-256 摘要，浏览器本地 0ms 比对，输入正确的一瞬间直接进入！
        if (serverAuthHash) {
            const currentHash = await sha256HexBrowser(rawVal);
            if (currentHash && currentHash === serverAuthHash && !isUnlocked && !isAutoUnlocking) {
                isAutoUnlocking = true;
                lockEmblemStage?.classList.add('unlocked-state');
                await tryUnlockAndLoad(rawVal, false, true);
                isAutoUnlocking = false;
            }
            return;
        }

        // 2. 兜底：若状态探测尚未返回摘要，停顿 220ms 后静默校验，正确则直接进入，不报错不抖动
        autoVerifyTimer = setTimeout(async () => {
            if (isUnlocked || isAutoUnlocking) return;
            const latestVal = (lockInput?.value || '').trim();
            if (!latestVal || latestVal.length < 3) return;
            isAutoUnlocking = true;
            await tryUnlockAndLoad(latestVal, false, true);
            isAutoUnlocking = false;
        }, 220);
    });

    function unlockUI() {
        isUnlocked = true;
        lockSubmitBtn?.classList.remove('verifying');
        lockEmblemStage?.classList.add('unlocked-state');
        document.body.classList.remove('locked');
        lockScreen?.classList.add('unlocked');
        if (lockError) {
            lockError.textContent = '';
            lockError.classList.remove('ok-msg');
        }
        dismissSiteLoader(60);
    }

    function showLockUI(hintMessage = '') {
        isUnlocked = false;
        lockSubmitBtn?.classList.remove('verifying');
        lockEmblemStage?.classList.remove('unlocked-state');
        document.body.classList.remove('batch-active');
        document.body.classList.add('locked');
        lockScreen?.classList.remove('unlocked');
        syncLockTypingVisualizer();
        if (hintMessage && lockError) {
            lockError.classList.remove('ok-msg');
            lockError.textContent = hintMessage;
        }
        dismissSiteLoader(100);
        setTimeout(() => lockInput?.focus(), 100);
    }

    function triggerLockShake(msg) {
        lockSubmitBtn?.classList.remove('verifying');
        lockEmblemStage?.classList.remove('unlocked-state');
        if (lockError) {
            lockError.classList.remove('ok-msg');
            lockError.textContent = msg;
        }
        if (lockForm) {
            lockForm.classList.remove('shake');
            void lockForm.offsetWidth;
            lockForm.classList.add('shake');
        }
    }

    async function probeServerStatus() {
        try {
            const res = await fetch('/api/images?action=status', { cache: 'no-store' });
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return;
            const info = await res.json();
            if (info.authHash) serverAuthHash = info.authHash;
            serverNeedsFirstSetup = Boolean(info.needsFirstSetup);

            // 如果用户在 status 返回前已经输入了正确密码，立即触发自动解锁
            const currentTyped = (lockInput?.value || '').trim();
            if (serverAuthHash && currentTyped && !isUnlocked && !isAutoUnlocking) {
                const typedHash = await sha256HexBrowser(currentTyped);
                if (typedHash === serverAuthHash) {
                    isAutoUnlocking = true;
                    lockEmblemStage?.classList.add('unlocked-state');
                    await tryUnlockAndLoad(currentTyped, false, true);
                    isAutoUnlocking = false;
                }
            }
        } catch {}
    }

    async function tryUnlockAndLoad(passwordAttempt, isInitialAutoCheck = false, isSilentTypingCheck = false) {
        if (!isSilentTypingCheck) {
            lockSubmitBtn?.classList.add('verifying');
        }

        // 如果本地已有缓存的云端快照且是自动登录，先在 <20ms 内瞬时渲染首屏
        const cachedSnapshot = isInitialAutoCheck ? loadCloudSnapshot() : null;
        if (cachedSnapshot && cachedSnapshot.length > 0) {
            isR2Connected = true;
            allImages = cachedSnapshot.map(item => ({ ...item, folder: normalizeFolder(item.folder) }));
            unlockUI();
            renderSpace();
        } else if (skeletonStageEl && !isSilentTypingCheck) {
            skeletonStageEl.hidden = false;
        }

        try {
            const headers = {};
            if (passwordAttempt) headers['Authorization'] = `Bearer ${passwordAttempt}`;

            const res = await fetch('/api/images', { headers });
            const ct = res.headers.get('content-type') || '';

            if (!ct.includes('application/json')) {
                if (!isLocalhost) {
                    if (skeletonStageEl) skeletonStageEl.hidden = true;
                    dismissSiteLoader(80);
                    if (!cachedSnapshot && !isSilentTypingCheck) {
                        triggerLockShake('连接异常，请刷新重试');
                    }
                    return false;
                }
                isR2Connected = false;
                if (!passwordAttempt) {
                    lockSubmitBtn?.classList.remove('verifying');
                    if (skeletonStageEl) skeletonStageEl.hidden = true;
                    showLockUI();
                    return false;
                }
                adminToken = passwordAttempt;
                localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
                allImages = loadLocalItems().map(item => ({ ...item, folder: normalizeFolder(item.folder) }));
                if (skeletonStageEl) skeletonStageEl.hidden = true;
                lockEmblemStage?.classList.add('unlocked-state');
                unlockUI();
                renderSpace();
                return true;
            }

            const data = await res.json();

            // 1. 密码错误：若只是打字过程中的静默探测，不报错不抖动；若是回车提交则提示错误
            if (res.status === 401 || res.status === 403 || data.locked || !data.isAdmin) {
                if (isSilentTypingCheck) {
                    return false;
                }
                localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
                localStorage.removeItem(STORAGE_KEYS.CLOUD_SNAPSHOT);
                adminToken = '';
                if (skeletonStageEl) skeletonStageEl.hidden = true;
                dismissSiteLoader(80);
                if (!isInitialAutoCheck) {
                    triggerLockShake(data.message || '密码错误');
                } else {
                    showLockUI();
                }
                return false;
            }

            // 2. 密码验证通过 -> 立即直接进入画廊！
            adminToken = passwordAttempt;
            localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
            sha256HexBrowser(passwordAttempt).then(h => { if (h) serverAuthHash = h; });
            serverNeedsFirstSetup = false;

            isR2Connected = Boolean(data.r2Bound);
            lockEmblemStage?.classList.add('unlocked-state');

            if (data.firstTimeInitialized) {
                toast('密码已加密锁定至 R2');
            }

            if (Array.isArray(data.categories)) {
                categoryMetaMap.clear();
                data.categories.forEach(c => {
                    const cleanName = normalizeFolder(c?.name);
                    if (cleanName) {
                        categoryMetaMap.set(cleanName, { name: cleanName, color: c.color || '' });
                    }
                });
                saveLocalCategories();
            }

            if (!isR2Connected) {
                allImages = [];
                if (skeletonStageEl) skeletonStageEl.hidden = true;
                unlockUI();
                renderSpace();
                return true;
            }

            allImages = (Array.isArray(data.items) ? data.items : []).map(item => ({
                ...item,
                folder: normalizeFolder(item.folder)
            }));
            saveCloudSnapshot(allImages);

            if (skeletonStageEl) skeletonStageEl.hidden = true;
            unlockUI();
            renderSpace();
            updateThumbAccelStatusUI();
            return true;
        } catch {
            if (isSilentTypingCheck) return false;
            if (skeletonStageEl) skeletonStageEl.hidden = true;
            dismissSiteLoader(80);
            if (cachedSnapshot && cachedSnapshot.length > 0) {
                return true;
            }
            if (!isLocalhost) {
                if (!isInitialAutoCheck) {
                    triggerLockShake('网络超时，请重试');
                } else {
                    showLockUI();
                }
                return false;
            }
            isR2Connected = false;
            if (!passwordAttempt) {
                showLockUI();
                return false;
            }
            adminToken = passwordAttempt;
            localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
            allImages = loadLocalItems().map(item => ({ ...item, folder: normalizeFolder(item.folder) }));
            unlockUI();
            renderSpace();
            return true;
        }
    }

    lockForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isUnlocked || isAutoUnlocking) return;
        const val = (lockInput?.value || '').trim();
        if (!val) {
            triggerLockShake('请输入密码');
            return;
        }
        await tryUnlockAndLoad(val, false, false);
    });

    /* =========================================================
       4. 缩略图尺寸无级调节器 (Thumbnail Zoom Scaler)
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
                    applyZoomChange(mobileZoomLevel + 1, true);
                } else {
                    applyZoomChange(mobileZoomLevel - 1, true);
                }
            }
        }
    }, { passive: true });

    /* =========================================================
       5-A. 国内视口优先 3 并发图片加载调度器 + 极速 WebP 缩略图回填引擎
            (彻底解决国内同时发起 20+ 跨境请求导致的 TCP 队头阻塞与假死)
    ========================================================= */
    const MAX_CONCURRENT_IMG_LOADS = 3;
    let activeImgLoads = 0;
    const pendingImgQueue = [];

    const viewportObserver = ('IntersectionObserver' in window)
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const task = entry.target._imgLoadTask;
                if (!task) return;
                task.inViewport = entry.isIntersecting;
                if (entry.isIntersecting && !task.started && !task.queued) {
                    task.queued = true;
                    pendingImgQueue.push(task);
                    pumpImageLoadQueue();
                }
            });
        }, { rootMargin: '280px 0px' })
        : null;

    function resetImageLoadQueue() {
        pendingImgQueue.length = 0;
        activeImgLoads = 0;
    }

    function pumpImageLoadQueue() {
        while (activeImgLoads < MAX_CONCURRENT_IMG_LOADS && pendingImgQueue.length > 0) {
            // 优先加载仍在当前可视区域内的图片
            let pickIdx = pendingImgQueue.findIndex(t => t.inViewport && !t.started);
            if (pickIdx === -1) {
                pickIdx = pendingImgQueue.findIndex(t => !t.started);
            }
            if (pickIdx === -1) break;

            const [task] = pendingImgQueue.splice(pickIdx, 1);
            if (!task || task.started) continue;
            task.started = true;
            activeImgLoads++;
            task.start(() => {
                activeImgLoads = Math.max(0, activeImgLoads - 1);
                pumpImageLoadQueue();
            });
        }
    }

    function scheduleCardImageLoad(imgEl, thumbWrap, item, isPriorityFirstScreen) {
        const primaryUrl = getFastThumbUrl(item, false);
        const directFallbackUrl = getFastThumbUrl(item, true);

        const task = {
            inViewport: isPriorityFirstScreen,
            queued: false,
            started: false,
            start(doneCallback) {
                let settled = false;
                let retryCount = 0;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    doneCallback();
                };

                // 单张缩略图超过 9 秒未响应则自动切换备用线路或释放并发槽位，绝不卡死后续图片
                const timeoutId = setTimeout(() => {
                    if (!settled && !imgEl.classList.contains('is-loaded')) {
                        if (retryCount === 0 && primaryUrl !== directFallbackUrl) {
                            retryCount++;
                            imgEl.src = directFallbackUrl;
                        } else {
                            finish();
                        }
                    }
                }, 9000);

                imgEl.onload = () => {
                    finish();
                    imgEl.classList.add('is-loaded');
                    thumbWrap?.classList.add('loaded-wrap');
                    if (thumbWrap) thumbWrap.style.backgroundImage = '';
                    const retryOverlay = thumbWrap?.querySelector('.thumb-retry-overlay');
                    if (retryOverlay) retryOverlay.hidden = true;

                    if ((!item.width || !item.height) && imgEl.naturalWidth && imgEl.naturalHeight) {
                        item.width = imgEl.naturalWidth;
                        item.height = imgEl.naturalHeight;
                    }

                    if (!item.thumbKey || !item.lqip) {
                        queueBackfillThumb(item, imgEl);
                    }
                };

                imgEl.onerror = () => {
                    if (retryCount === 0) {
                        retryCount++;
                        // 如果 wsrv 代理或首次请求失败，立刻回退直连或加时间戳重试
                        const nextUrl = (primaryUrl !== directFallbackUrl)
                            ? directFallbackUrl
                            : `${primaryUrl}${primaryUrl.includes('?') ? '&' : '?'}_retry=${Date.now()}`;
                        setTimeout(() => {
                            imgEl.src = nextUrl;
                        }, 300);
                    } else {
                        finish();
                        const retryOverlay = thumbWrap?.querySelector('.thumb-retry-overlay');
                        if (retryOverlay) retryOverlay.hidden = false;
                    }
                };

                imgEl.src = primaryUrl;
            }
        };

        imgEl._imgLoadTask = task;

        if (isPriorityFirstScreen || !viewportObserver) {
            task.queued = true;
            pendingImgQueue.push(task);
            pumpImageLoadQueue();
        } else {
            viewportObserver.observe(imgEl);
        }
    }

    // 针对存量未生成缩略图的历史大图：生成 600px 高清轻量 WebP (~15KB) 与 24px LQIP 写回 R2
    const backfilledKeys = new Set();
    let isBackfilling = false;
    const backfillQueue = [];

    function createCanvasThumbAndLqip(imgSource) {
        return new Promise((resolve) => {
            try {
                const nw = imgSource.naturalWidth || 1200;
                const nh = imgSource.naturalHeight || 900;

                let lw = 24;
                let lh = Math.max(12, Math.round((nh * 24) / nw));
                if (nh > nw) {
                    lh = 24;
                    lw = Math.max(12, Math.round((nw * 24) / nh));
                }
                const lCanvas = document.createElement('canvas');
                lCanvas.width = lw;
                lCanvas.height = lh;
                lCanvas.getContext('2d').drawImage(imgSource, 0, 0, lw, lh);
                let lqip = '';
                try {
                    lqip = lCanvas.toDataURL('image/webp', 0.48);
                    if (!lqip.startsWith('data:image/webp')) {
                        lqip = lCanvas.toDataURL('image/jpeg', 0.48);
                    }
                } catch {
                    lqip = '';
                }

                // 600px WebP 缩略图：兼顾 Retina 清晰度与 ~15KB 极小体积，国内毫秒级加载
                const thumbMax = 600;
                let tw = nw;
                let th = nh;
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
                tCanvas.getContext('2d').drawImage(imgSource, 0, 0, tw, th);
                tCanvas.toBlob((thumbBlob) => {
                    resolve({ thumbBlob, lqip, width: nw, height: nh });
                }, 'image/webp', 0.74);
            } catch {
                resolve({ thumbBlob: null, lqip: '', width: 0, height: 0 });
            }
        });
    }

    async function uploadBackfillForItem(item, imgSource) {
        const { thumbBlob, lqip, width, height } = await createCanvasThumbAndLqip(imgSource);
        if (!thumbBlob) return false;
        const fd = new FormData();
        fd.append('action', 'backfillThumb');
        fd.append('key', item.key);
        fd.append('thumb', new File([thumbBlob], 'thumb.webp', { type: 'image/webp' }));
        if (lqip) fd.append('lqip', lqip);
        if (width) fd.append('width', String(width));
        if (height) fd.append('height', String(height));

        const headers = {};
        if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
        const res = await fetch('/api/images', { method: 'POST', headers, body: fd });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.ok) {
            item.thumbKey = data.thumbKey;
            item.thumbUrl = data.thumbUrl;
            if (data.lqip) item.lqip = data.lqip;
            if (width) item.width = width;
            if (height) item.height = height;
            saveCloudSnapshot(allImages);
            updateThumbAccelStatusUI();
            return true;
        }
        return false;
    }

    async function processBackfillQueue() {
        if (isBackfilling || backfillQueue.length === 0) return;
        isBackfilling = true;
        while (backfillQueue.length > 0) {
            const { item, imgEl } = backfillQueue.shift();
            if (!item || !item.key || backfilledKeys.has(item.key)) continue;
            backfilledKeys.add(item.key);
            try {
                await uploadBackfillForItem(item, imgEl);
            } catch {}
            await new Promise(r => setTimeout(r, 500));
        }
        isBackfilling = false;
    }

    function queueBackfillThumb(item, imgEl) {
        if (!isR2Connected || item.isDemo || !item.key) return;
        const ext = (item.key.split('.').pop() || '').toLowerCase();
        if (ext === 'svg' || ext === 'gif') return;
        if (item.thumbKey && item.lqip) return;
        if (backfilledKeys.has(item.key)) return;
        backfillQueue.push({ item, imgEl });
        setTimeout(processBackfillQueue, 900);
    }

    // 设置面板中的「国内极速缩略图覆盖率」与「一键全量生成极速缩略图」
    const thumbAccelStatusEl = document.getElementById('thumb-accel-status');
    const btnOptimizeAllThumbs = document.getElementById('btn-optimize-all-thumbs');

    function getUnoptimizedItems() {
        return allImages.filter(item => {
            if (!item || item.isDemo || !item.key) return false;
            const ext = (item.key.split('.').pop() || '').toLowerCase();
            if (ext === 'svg' || ext === 'gif') return false;
            return !item.thumbKey || !item.lqip;
        });
    }

    function updateThumbAccelStatusUI() {
        if (!thumbAccelStatusEl) return;
        if (!isR2Connected || allImages.length === 0) {
            thumbAccelStatusEl.textContent = `0 / 0 已加速`;
            return;
        }
        const missing = getUnoptimizedItems().length;
        const accelerated = Math.max(0, allImages.length - missing);
        thumbAccelStatusEl.textContent = `${accelerated} / ${allImages.length} 已生成极速缩略图`;
        if (btnOptimizeAllThumbs && !btnOptimizeAllThumbs.disabled) {
            btnOptimizeAllThumbs.textContent = missing > 0
                ? `一键加速剩余 ${missing} 张历史大图`
                : '全部图片已完成极速缩略图加速 ✓';
        }
    }

    btnOptimizeAllThumbs?.addEventListener('click', async () => {
        if (!isR2Connected) return toast('未连接 R2 存储桶');
        const missingList = getUnoptimizedItems();
        if (missingList.length === 0) {
            return toast('所有图片均已拥有 ~15KB 极速缩略图');
        }
        btnOptimizeAllThumbs.disabled = true;
        let done = 0;
        for (const item of missingList) {
            btnOptimizeAllThumbs.textContent = `正在生成极速缩略图 (${done + 1}/${missingList.length})...`;
            try {
                const img = await new Promise((resolve, reject) => {
                    const el = new Image();
                    el.crossOrigin = 'anonymous';
                    el.onload = () => resolve(el);
                    el.onerror = reject;
                    el.src = getFullUrl(item);
                });
                await uploadBackfillForItem(item, img);
                done++;
            } catch {}
        }
        btnOptimizeAllThumbs.disabled = false;
        updateThumbAccelStatusUI();
        renderSpace();
        toast(`已完成 ${done} 张图片的国内极速缩略图生成`);
    });

    /* =========================================================
       5-B. 分类导航栏 + 拖拽归档 + 瀑布流画廊 (Categories & Timeline)
    ========================================================= */
    const folderTabsEl = document.getElementById('folder-tabs');
    const batchMoveSelect = document.getElementById('batch-move-select');
    const timelineStreamEl = document.getElementById('timeline-stream');
    const emptyStageEl = document.getElementById('empty-stage');
    const storageStat = document.getElementById('storage-stat');
    const dropTargetHint = document.getElementById('drop-target-hint');

    async function moveImagesToCategory(keys, targetFolder) {
        const cleanFolder = normalizeFolder(targetFolder);
        if (!keys || keys.length === 0) return false;

        if (cleanFolder && !categoryMetaMap.has(cleanFolder)) {
            categoryMetaMap.set(cleanFolder, { name: cleanFolder, color: getCategoryColor(cleanFolder) });
            saveLocalCategories();
        }

        if (isR2Connected) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
                const res = await fetch('/api/images', {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        keys,
                        folder: cleanFolder,
                        categories: Array.from(categoryMetaMap.values())
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.ok) {
                    toast(data.error || '移动失败');
                    return false;
                }
            } catch {
                toast('网络错误');
                return false;
            }
        }

        const keySet = new Set(keys);
        allImages.forEach(img => {
            if (keySet.has(img.key)) img.folder = cleanFolder;
        });
        if (isR2Connected) saveCloudSnapshot(allImages);
        else saveLocalItems();
        renderSpace();
        if (cleanFolder) {
            toast(`已移入「${formatFolderDisplayName(cleanFolder)}」`);
        }
        return true;
    }

    function bindTabDropTarget(tabBtn, targetFolder) {
        if (targetFolder === 'all') return;
        tabBtn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tabBtn.classList.add('drag-over');
        });
        tabBtn.addEventListener('dragleave', () => {
            tabBtn.classList.remove('drag-over');
        });
        tabBtn.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            tabBtn.classList.remove('drag-over');
            dropOverlay?.classList.remove('active');
            dragDepth = 0;

            const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) {
                await uploadFiles(files, targetFolder);
                return;
            }

            const draggedKey = e.dataTransfer?.getData('text/xiang-photo-key');
            if (draggedKey) {
                const keysToMove = selectedKeys.has(draggedKey) && selectedKeys.size > 0
                    ? Array.from(selectedKeys)
                    : [draggedKey];
                await moveImagesToCategory(keysToMove, targetFolder);
            }
        });
    }

    function renderFolders() {
        if (!folderTabsEl) return;

        const folderCounts = new Map();
        categoryMetaMap.forEach((_, name) => {
            const clean = normalizeFolder(name);
            if (clean && !folderCounts.has(clean)) folderCounts.set(clean, 0);
        });
        allImages.forEach(item => {
            const f = normalizeFolder(item.folder);
            if (f) {
                folderCounts.set(f, (folderCounts.get(f) || 0) + 1);
            }
        });

        if (currentFolder !== 'all' && !folderCounts.has(currentFolder)) {
            currentFolder = 'all';
        }

        folderTabsEl.innerHTML = '';

        // 1. 全部标签
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = `tab-item ${currentFolder === 'all' ? 'active' : ''}`;
        allBtn.style.setProperty('--cat-color', '#0f172a');
        allBtn.innerHTML = `
            <span class="tab-dot"></span>
            <span>全部</span>
            <span class="tab-count">${allImages.length}</span>
        `;
        allBtn.addEventListener('click', () => {
            currentFolder = 'all';
            renderSpace();
        });
        folderTabsEl.appendChild(allBtn);

        // 2. 用户创建的各个分类标签（不再强制生成默认分类）
        const folderList = Array.from(folderCounts.keys());
        folderList.forEach(folder => {
            const count = folderCounts.get(folder) || 0;
            const color = getCategoryColor(folder);
            const label = formatFolderDisplayName(folder);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `tab-item ${currentFolder === folder ? 'active' : ''}`;
            btn.style.setProperty('--cat-color', color);
            btn.title = `${label}（支持拖拽图片至此归档）`;
            btn.innerHTML = `
                <span class="tab-dot"></span>
                <span>${label}</span>
                <span class="tab-count">${count}</span>
            `;
            btn.addEventListener('click', () => {
                currentFolder = folder;
                renderSpace();
            });
            bindTabDropTarget(btn, folder);
            folderTabsEl.appendChild(btn);
        });

        if (batchMoveSelect) {
            batchMoveSelect.innerHTML = `<option value="">移动至分类...</option>`;
            folderList.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `→ ${formatFolderDisplayName(f)}`;
                batchMoveSelect.appendChild(opt);
            });
            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = '+ 新建分类...';
            batchMoveSelect.appendChild(newOpt);
        }

        const targetUploadFolder = currentFolder === 'all' ? '' : currentFolder;
        if (dropTargetHint) {
            dropTargetHint.textContent = targetUploadFolder
                ? `上传至「${formatFolderDisplayName(targetUploadFolder)}」`
                : '松开上传';
        }
    }

    /* =========================================================
       5-C. 分类管理弹窗 (#category-modal) & 单卡快捷菜单 (#quick-cat-popover)
    ========================================================= */
    const categoryModal = document.getElementById('category-modal');
    const formCreateCategory = document.getElementById('form-create-category');
    const inputNewCatName = document.getElementById('input-new-cat-name');
    const newCatColorPreview = document.getElementById('new-cat-color-preview');
    const newCatPaletteEl = document.getElementById('new-cat-palette');
    const catManageListEl = document.getElementById('cat-manage-list');
    const catModalCountEl = document.getElementById('cat-modal-count');

    let selectedNewCatColor = DYNAMIC_PALETTE[0];
    let pendingMoveKeysAfterCreate = null;

    function renderNewCategoryPalette() {
        if (!newCatPaletteEl) return;
        newCatPaletteEl.innerHTML = '';
        if (newCatColorPreview) {
            newCatColorPreview.style.background = selectedNewCatColor;
        }
        DYNAMIC_PALETTE.forEach(color => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = `cat-swatch ${color === selectedNewCatColor ? 'active' : ''}`;
            swatch.style.background = color;
            swatch.addEventListener('click', () => {
                selectedNewCatColor = color;
                renderNewCategoryPalette();
            });
            newCatPaletteEl.appendChild(swatch);
        });
    }

    function renderCategoryStudioList() {
        if (!catManageListEl) return;
        const folderCounts = new Map();
        categoryMetaMap.forEach((_, name) => {
            const clean = normalizeFolder(name);
            if (clean && !folderCounts.has(clean)) folderCounts.set(clean, 0);
        });
        allImages.forEach(item => {
            const f = normalizeFolder(item.folder);
            if (f) {
                folderCounts.set(f, (folderCounts.get(f) || 0) + 1);
            }
        });

        const folders = Array.from(folderCounts.keys());
        if (catModalCountEl) {
            catModalCountEl.textContent = `${folders.length}`;
        }

        catManageListEl.innerHTML = '';

        if (folders.length === 0) {
            catManageListEl.innerHTML = `<div style="padding:14px 8px;text-align:center;color:var(--ink-3);font-size:12px;">暂无分类，可在上方输入名称添加</div>`;
            return;
        }

        folders.forEach(folder => {
            const count = folderCounts.get(folder) || 0;
            const color = getCategoryColor(folder);
            const label = formatFolderDisplayName(folder);

            const row = document.createElement('div');
            row.className = 'cat-manage-row';
            row.innerHTML = `
                <div class="cat-row-left">
                    <button type="button" class="cat-row-color-btn" style="background:${color}" title="切换颜色"></button>
                    <span class="cat-row-name">${label}</span>
                    <span class="cat-row-count">${count}</span>
                </div>
                <div class="cat-row-actions">
                    <button type="button" class="cat-mini-btn btn-cat-view">查看</button>
                    <button type="button" class="cat-mini-btn btn-cat-rename">改名</button>
                    <button type="button" class="cat-mini-btn danger btn-cat-delete">删除</button>
                </div>
            `;

            row.querySelector('.cat-row-color-btn')?.addEventListener('click', async () => {
                const idx = DYNAMIC_PALETTE.indexOf(color);
                const nextColor = DYNAMIC_PALETTE[(idx + 1) % DYNAMIC_PALETTE.length];
                categoryMetaMap.set(folder, { name: folder, color: nextColor });
                await syncCategoriesToCloud();
                renderCategoryStudioList();
                renderSpace();
            });

            row.querySelector('.btn-cat-view')?.addEventListener('click', () => {
                currentFolder = folder;
                closeCategoryModal();
                renderSpace();
            });

            row.querySelector('.btn-cat-rename')?.addEventListener('click', async () => {
                const nextRaw = prompt(`重命名「${label}」为：`, folder);
                if (!nextRaw) return;
                const cleanNext = normalizeFolder(nextRaw.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-'));
                if (!cleanNext || cleanNext === folder) return;

                const oldColor = getCategoryColor(folder);
                categoryMetaMap.delete(folder);
                categoryMetaMap.set(cleanNext, { name: cleanNext, color: oldColor });

                const affectedKeys = allImages.filter(i => normalizeFolder(i.folder) === folder).map(i => i.key);
                if (affectedKeys.length > 0) {
                    await moveImagesToCategory(affectedKeys, cleanNext);
                } else {
                    await syncCategoriesToCloud();
                }

                if (currentFolder === folder) currentFolder = cleanNext;
                renderCategoryStudioList();
                renderSpace();
                toast(`已重命名为「${cleanNext}」`);
            });

            row.querySelector('.btn-cat-delete')?.addEventListener('click', async () => {
                const msg = count > 0
                    ? `删除分类「${label}」？（图片不会丢失，将保留在全部列表中）`
                    : `删除分类「${label}」？`;
                if (!confirm(msg)) return;

                categoryMetaMap.delete(folder);
                const affectedKeys = allImages.filter(i => normalizeFolder(i.folder) === folder).map(i => i.key);
                if (affectedKeys.length > 0) {
                    await moveImagesToCategory(affectedKeys, '');
                } else {
                    await syncCategoriesToCloud();
                }

                if (currentFolder === folder) currentFolder = 'all';
                renderCategoryStudioList();
                renderSpace();
                toast(`已删除「${label}」`);
            });

            catManageListEl.appendChild(row);
        });
    }

    function openCategoryModal(focusNewInput = true, keysToMoveOnCreate = null) {
        pendingMoveKeysAfterCreate = keysToMoveOnCreate;
        renderNewCategoryPalette();
        renderCategoryStudioList();
        categoryModal?.classList.add('open');
        if (focusNewInput) {
            setTimeout(() => inputNewCatName?.focus(), 60);
        }
    }

    function closeCategoryModal() {
        pendingMoveKeysAfterCreate = null;
        categoryModal?.classList.remove('open');
    }

    formCreateCategory?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = (inputNewCatName?.value || '').trim();
        if (!raw) {
            toast('请输入分类名称');
            inputNewCatName?.focus();
            return;
        }
        const clean = normalizeFolder(raw.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-'));
        if (!clean) {
            toast('名称无效');
            return;
        }

        categoryMetaMap.set(clean, { name: clean, color: selectedNewCatColor });
        if (inputNewCatName) inputNewCatName.value = '';

        const nextIdx = (DYNAMIC_PALETTE.indexOf(selectedNewCatColor) + 1) % DYNAMIC_PALETTE.length;
        selectedNewCatColor = DYNAMIC_PALETTE[nextIdx];

        if (pendingMoveKeysAfterCreate && pendingMoveKeysAfterCreate.length > 0) {
            const keys = [...pendingMoveKeysAfterCreate];
            pendingMoveKeysAfterCreate = null;
            await moveImagesToCategory(keys, clean);
            closeCategoryModal();
            return;
        }

        await syncCategoriesToCloud();
        currentFolder = clean;
        renderNewCategoryPalette();
        renderCategoryStudioList();
        renderSpace();
        toast(`已创建「${clean}」`);
    });

    document.getElementById('btn-new-folder')?.addEventListener('click', () => openCategoryModal(true));
    document.getElementById('mob-btn-cat')?.addEventListener('click', () => openCategoryModal(false));
    document.getElementById('category-modal-close')?.addEventListener('click', closeCategoryModal);
    categoryModal?.addEventListener('click', (e) => {
        if (e.target === categoryModal) closeCategoryModal();
    });

    const quickCatPopover = document.getElementById('quick-cat-popover');
    const quickCatListEl = document.getElementById('quick-cat-list');
    const quickCatNewBtn = document.getElementById('quick-cat-new-btn');
    let activePopoverItemKey = null;

    function closeQuickCatPopover() {
        activePopoverItemKey = null;
        if (quickCatPopover) quickCatPopover.hidden = true;
    }

    function openQuickCatPopover(item, anchorEl) {
        if (!quickCatPopover || !quickCatListEl || !item) return;
        activePopoverItemKey = item.key;
        const currentItemFolder = normalizeFolder(item.folder);
        const allCats = getAllCategoryNames();

        if (allCats.length === 0) {
            openCategoryModal(true, [item.key]);
            return;
        }

        quickCatListEl.innerHTML = '';
        allCats.forEach(folder => {
            const color = getCategoryColor(folder);
            const label = formatFolderDisplayName(folder);
            const isCurr = folder === currentItemFolder;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `popover-cat-item ${isCurr ? 'current' : ''}`;
            btn.innerHTML = `
                <span class="popover-cat-left">
                    <span class="cat-badge-dot" style="background:${color}; width:7px; height:7px;"></span>
                    <span>${label}</span>
                </span>
                <span>${isCurr ? '✓' : ''}</span>
            `;
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeQuickCatPopover();
                if (!isCurr) {
                    await moveImagesToCategory([item.key], folder);
                } else {
                    currentFolder = folder;
                    renderSpace();
                }
            });
            quickCatListEl.appendChild(btn);
        });

        quickCatPopover.hidden = false;
        const rect = anchorEl.getBoundingClientRect();
        const popW = 190;
        const popH = Math.min(260, allCats.length * 34 + 54);
        let left = Math.min(window.innerWidth - popW - 12, Math.max(12, rect.left));
        let top = rect.bottom + 6;
        if (top + popH > window.innerHeight - 16) {
            top = Math.max(12, rect.top - popH - 6);
        }
        quickCatPopover.style.left = `${left}px`;
        quickCatPopover.style.top = `${top}px`;
    }

    quickCatNewBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = activePopoverItemKey;
        closeQuickCatPopover();
        if (key) {
            openCategoryModal(true, [key]);
        } else {
            openCategoryModal(true);
        }
    });

    document.addEventListener('click', (e) => {
        if (quickCatPopover && !quickCatPopover.hidden && !quickCatPopover.contains(e.target)) {
            closeQuickCatPopover();
        }
    });

    const searchInputEl = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');

    searchInputEl?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        if (searchClearBtn) searchClearBtn.hidden = !searchQuery;
        renderSpace();
    });

    searchClearBtn?.addEventListener('click', () => {
        if (searchInputEl) searchInputEl.value = '';
        searchQuery = '';
        searchClearBtn.hidden = true;
        renderSpace();
    });

    function renderSpace() {
        if (!isUnlocked) return;
        closeQuickCatPopover();
        syncZoomUI();
        updateStorageQuotaUI();
        renderFolders();

        allImages.sort((a, b) => new Date(b.uploaded || 0).getTime() - new Date(a.uploaded || 0).getTime());

        filteredImages = allImages.filter(item => {
            const f = normalizeFolder(item.folder);
            if (currentFolder !== 'all' && f !== currentFolder) return false;
            if (!searchQuery) return true;
            const hay = [item.title, item.originalName, item.key, f, item.exif?.camera].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(searchQuery);
        });

        const numCols = getColumnCount();

        if (storageStat) {
            storageStat.textContent = String(filteredImages.length);
        }

        if (!timelineStreamEl || !emptyStageEl) return;

        resetImageLoadQueue();

        if (filteredImages.length === 0) {
            timelineStreamEl.innerHTML = '';
            emptyStageEl.hidden = false;
            return;
        }

        emptyStageEl.hidden = true;
        timelineStreamEl.innerHTML = '';

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

        let sectionIdx = 0;
        dayGroups.forEach((group) => {
            const section = document.createElement('section');
            section.className = 'timeline-section';
            section.style.animationDelay = `${Math.min(sectionIdx * 45, 180)}ms`;
            sectionIdx++;

            section.innerHTML = `
                <div class="timeline-header">
                    <div class="timeline-date-group">
                        <span class="timeline-dot"></span>
                        <span class="timeline-date-title">${group.title}</span>
                        <span class="timeline-date-sub">${group.sub}</span>
                    </div>
                    <div class="timeline-meta-right">
                        <span>${group.entries.length}</span>
                        <button type="button" class="timeline-select-day-btn">全选</button>
                    </div>
                </div>
                <div class="masonry-board" style="grid-template-columns: repeat(${numCols}, 1fr);"></div>
            `;

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
                card.draggable = true;

                card.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/xiang-photo-key', item.key);
                });

                const folderName = normalizeFolder(item.folder);
                const folderLabel = folderName ? formatFolderDisplayName(folderName) : '+ 分类';
                const catColor = getCategoryColor(folderName);
                const name = item.title || item.originalName || item.key.split('/').pop();
                const fullUrl = getFullUrl(item);

                const aspectStyle = (w > 0 && h > 0) ? `style="aspect-ratio: ${w} / ${h};"` : '';

                // 纯粹毛玻璃悬浮画布卡片：底栏信息内嵌为悬浮毛玻璃层 (.photo-glass-bar)
                card.innerHTML = `
                    <div class="photo-thumb-wrap" ${aspectStyle}>
                        <button type="button" class="thumb-check" title="选择">${isSelected ? '✓' : ''}</button>
                        <img alt="${name}" decoding="async">
                        <div class="thumb-retry-overlay" hidden><span>点击重试</span></div>
                        <div class="photo-glass-bar">
                            <button type="button" class="cat-badge" style="--cat-color: ${catColor}" title="设置分类">
                                ${folderName ? '<span class="cat-badge-dot"></span>' : ''}
                                <span>${folderLabel}</span>
                            </button>
                            <button type="button" class="thumb-copy-btn" title="复制直链">复制</button>
                        </div>
                    </div>
                `;

                const thumbWrap = card.querySelector('.photo-thumb-wrap');
                const imgEl = card.querySelector('img');
                const retryOverlay = card.querySelector('.thumb-retry-overlay');
                const copyBtn = card.querySelector('.thumb-copy-btn');
                const catBadgeBtn = card.querySelector('.cat-badge');

                // 0ms 瞬时模糊图占位 (LQIP)
                if (item.lqip && thumbWrap) {
                    thumbWrap.style.backgroundImage = `url(${item.lqip})`;
                    thumbWrap.style.backgroundSize = 'cover';
                    thumbWrap.style.backgroundPosition = 'center';
                }

                // 纳入国内 3 并发视口优先智能加载队列
                scheduleCardImageLoad(imgEl, thumbWrap, item, globalFilteredIdx < 6);

                retryOverlay?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    retryOverlay.hidden = true;
                    const directUrl = getFastThumbUrl(item, true);
                    const sep = directUrl.includes('?') ? '&' : '?';
                    imgEl.src = `${directUrl}${sep}_retry=${Date.now()}`;
                });

                catBadgeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openQuickCatPopover(item, catBadgeBtn);
                });

                card.querySelector('.thumb-check').addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleSelection(item.key);
                });

                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyText(fullUrl, '直链');
                    copyBtn.classList.add('copied');
                    copyBtn.textContent = '✓';
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.textContent = '复制';
                    }, 1000);
                });

                thumbWrap.addEventListener('click', () => {
                    if (isBatchMode || selectedKeys.size > 0) {
                        toggleSelection(item.key);
                    } else {
                        openViewer(globalFilteredIdx, imgEl.currentSrc || getFastThumbUrl(item));
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
        if (btnBatchToggle) btnBatchToggle.textContent = active ? '完成' : '多选';
        if (mobBtnBatch) mobBtnBatch.textContent = active ? '完成' : '多选';
        if (selectionDock) selectionDock.hidden = !active;
        if (selCountEl) selCountEl.textContent = `已选 ${count}`;
    }

    function toggleSelection(key) {
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
        updateSelectionCardDOM(key);
        syncBatchUI();
    }

    function clearBatchMode() {
        isBatchMode = false;
        const prev = Array.from(selectedKeys);
        selectedKeys.clear();
        prev.forEach(k => updateSelectionCardDOM(k));
        syncBatchUI();
    }

    function handleToggleBatchMode() {
        if (isBatchMode || selectedKeys.size > 0) {
            clearBatchMode();
        } else {
            isBatchMode = true;
            syncBatchUI();
        }
    }

    btnBatchToggle?.addEventListener('click', handleToggleBatchMode);
    mobBtnBatch?.addEventListener('click', handleToggleBatchMode);

    document.getElementById('btn-sel-all')?.addEventListener('click', () => {
        filteredImages.forEach(item => {
            selectedKeys.add(item.key);
            updateSelectionCardDOM(item.key);
        });
        syncBatchUI();
    });

    document.getElementById('btn-sel-invert')?.addEventListener('click', () => {
        filteredImages.forEach(item => {
            if (selectedKeys.has(item.key)) selectedKeys.delete(item.key);
            else selectedKeys.add(item.key);
            updateSelectionCardDOM(item.key);
        });
        syncBatchUI();
    });

    batchMoveSelect?.addEventListener('change', async (e) => {
        let target = e.target.value;
        e.target.value = '';
        if (!target) return;

        const keys = Array.from(selectedKeys);
        if (!keys.length) return toast('请先选择图片');

        if (target === '__new__') {
            openCategoryModal(true, keys);
            return;
        }

        await moveImagesToCategory(keys, target);
    });

    function getSelectedItemsList() {
        return filteredImages.filter(i => selectedKeys.has(i.key));
    }

    document.getElementById('btn-sel-copy-url')?.addEventListener('click', () => {
        const items = getSelectedItemsList();
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => buildFormats(i).url).join('\n'), `${items.length} 条链接`);
    });

    document.getElementById('btn-sel-copy-md')?.addEventListener('click', () => {
        const items = getSelectedItemsList();
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => buildFormats(i).md).join('\n'), `${items.length} 条 MD`);
    });

    document.getElementById('btn-sel-copy-html')?.addEventListener('click', () => {
        const items = getSelectedItemsList();
        if (!items.length) return toast('请先选择图片');
        copyText(items.map(i => buildFormats(i).html).join('\n'), `${items.length} 条 HTML`);
    });

    document.getElementById('btn-sel-download')?.addEventListener('click', () => {
        const items = getSelectedItemsList();
        if (!items.length) return toast('请先选择图片');
        items.forEach((item, idx) => {
            setTimeout(() => {
                const a = document.createElement('a');
                a.href = getFullUrl(item);
                a.download = item.originalName || item.key.split('/').pop();
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }, idx * 220);
        });
        toast(`开始下载 ${items.length} 项`);
    });

    document.getElementById('btn-sel-delete')?.addEventListener('click', async () => {
        const keys = Array.from(selectedKeys);
        if (!keys.length) return toast('请先选择图片');
        if (!confirm(`确定删除选中的 ${keys.length} 张图片吗？`)) return;
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
        if (isR2Connected) saveCloudSnapshot(allImages);
        else saveLocalItems();
        renderSpace();
        updateThumbAccelStatusUI();
        toast(`已删除 ${keys.length} 项`);
        return true;
    }

    /* =========================================================
       7. 极速双层上传引擎 (600px WebP 缩略图 + 24px LQIP + 原生 EXIF)
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
        if (!file || !file.type.includes('jpeg')) return {};
        try {
            const slice = file.slice(0, 131072);
            const buf = await slice.arrayBuffer();
            const view = new DataView(buf);
            if (view.byteLength < 12 || view.getUint16(0, false) !== 0xFFD8) return {};

            let offset = 2;
            while (offset + 4 < view.byteLength) {
                const marker = view.getUint16(offset, false);
                offset += 2;
                if (marker === 0xFFE1) {
                    const length = view.getUint16(offset, false);
                    if (offset + 8 >= view.byteLength) break;
                    if (view.getUint32(offset + 2, false) !== 0x45786966) {
                        offset += length;
                        continue;
                    }
                    const tiffStart = offset + 8;
                    const little = view.getUint16(tiffStart, false) === 0x4949;
                    const firstIfd = view.getUint32(tiffStart + 4, little);
                    const tags = {};

                    const readString = (start, count) => {
                        let s = '';
                        for (let i = 0; i < count - 1 && start + i < view.byteLength; i++) {
                            const ch = view.getUint8(start + i);
                            if (ch === 0) break;
                            s += String.fromCharCode(ch);
                        }
                        return s.trim();
                    };

                    const readRational = (start) => {
                        if (start + 8 > view.byteLength) return 0;
                        const num = view.getUint32(start, little);
                        const den = view.getUint32(start + 4, little);
                        return den ? num / den : 0;
                    };

                    const parseIfd = (ifdOffset) => {
                        const dirStart = tiffStart + ifdOffset;
                        if (dirStart + 2 > view.byteLength) return;
                        const entries = view.getUint16(dirStart, little);
                        for (let i = 0; i < entries; i++) {
                            const entry = dirStart + 2 + i * 12;
                            if (entry + 12 > view.byteLength) break;
                            const tag = view.getUint16(entry, little);
                            const type = view.getUint16(entry + 2, little);
                            const count = view.getUint32(entry + 4, little);
                            const valOffset = tiffStart + view.getUint32(entry + 8, little);

                            if (tag === 0x8769) {
                                parseIfd(view.getUint32(entry + 8, little));
                            } else if ((tag === 0x010F || tag === 0x0110 || tag === 0xA434) && type === 2) {
                                const strPos = count <= 4 ? entry + 8 : valOffset;
                                tags[tag] = readString(strPos, count);
                            } else if ((tag === 0x829A || tag === 0x829D || tag === 0x920A) && type === 5) {
                                tags[tag] = readRational(valOffset);
                            } else if (tag === 0x8827) {
                                tags[tag] = type === 3 ? view.getUint16(entry + 8, little) : view.getUint32(entry + 8, little);
                            }
                        }
                    };

                    parseIfd(firstIfd);

                    const make = tags[0x010F] || '';
                    const model = tags[0x0110] || '';
                    const camera = [make, model].filter(Boolean).join(' ').replace(/^(\S+)\s+\1/i, '$1').trim();
                    const exp = tags[0x829A];
                    const shutter = exp ? (exp < 1 ? `1/${Math.round(1 / exp)}s` : `${exp}s`) : '';

                    return {
                        camera,
                        lens: tags[0xA434] || '',
                        focal: tags[0x920A] ? `${Math.round(tags[0x920A])}mm` : '',
                        aperture: tags[0x829D] ? `f/${Number(tags[0x829D]).toFixed(1).replace(/\.0$/, '')}` : '',
                        shutter,
                        iso: tags[0x8827] ? String(tags[0x8827]) : ''
                    };
                } else if ((marker & 0xFF00) !== 0xFF00) {
                    break;
                } else {
                    offset += view.getUint16(offset, false);
                }
            }
            return {};
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

        let thumbBlob = null;
        let lqip = '';
        if (file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
            const generated = await createCanvasThumbAndLqip(img);
            thumbBlob = generated.thumbBlob;
            lqip = generated.lqip;
        }

        if (uploadMode === 'original' || file.type === 'image/svg+xml' || file.type === 'image/gif') {
            return { file, thumbBlob, lqip, width, height };
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
        return { file: out, thumbBlob, lqip, width, height };
    }

    async function uploadFiles(files, explicitFolder = null) {
        const targetFolder = normalizeFolder(explicitFolder !== null ? explicitFolder : (currentFolder === 'all' ? '' : currentFolder));
        const targetLabel = targetFolder ? formatFolderDisplayName(targetFolder) : '';
        if (uploadRibbon) uploadRibbon.hidden = false;

        let completed = 0;
        const total = files.length;

        for (const rawFile of files) {
            if (ribbonText) ribbonText.textContent = `正在上传 ${rawFile.name} (${completed + 1}/${total})...`;
            const pct = Math.round(((completed + 0.25) / total) * 100);
            if (ribbonBar) ribbonBar.style.width = `${pct}%`;
            if (ribbonPercent) ribbonPercent.textContent = `${pct}%`;

            try {
                const [exif, { file, thumbBlob, lqip, width, height }] = await Promise.all([
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
                    if (lqip) {
                        fd.append('lqip', lqip);
                    }
                    fd.append('folder', targetFolder);
                    fd.append('customName', rawFile.name.replace(/\.[^/.]+$/, ''));
                    fd.append('title', rawFile.name.replace(/\.[^/.]+$/, ''));
                    fd.append('width', String(width));
                    fd.append('height', String(height));
                    fd.append('exif', JSON.stringify(exif));

                    const headers = {};
                    if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;

                    const res = await fetch('/api/images', { method: 'POST', headers, body: fd });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                        throw new Error(data.error || '上传失败');
                    }
                    newItem = data.item;
                } else {
                    const dataUrl = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onload = () => r(reader.result);
                        reader.readAsDataURL(thumbBlob || file);
                    });
                    newItem = {
                        key: `${targetFolder || 'uploads'}/${Date.now()}-${file.name}`,
                        url: dataUrl,
                        thumbUrl: dataUrl,
                        lqip,
                        size: file.size,
                        uploaded: new Date().toISOString(),
                        folder: targetFolder,
                        originalName: file.name,
                        title: rawFile.name.replace(/\.[^/.]+$/, ''),
                        width,
                        height,
                        isDemo: true,
                        exif
                    };
                }

                allImages.unshift(newItem);
                if (isR2Connected) saveCloudSnapshot(allImages);
                else saveLocalItems();
                completed++;
                const donePct = Math.round((completed / total) * 100);
                if (ribbonBar) ribbonBar.style.width = `${donePct}%`;
                if (ribbonPercent) ribbonPercent.textContent = `${donePct}%`;
                renderSpace();
                updateThumbAccelStatusUI();
            } catch (err) {
                toast(err.message || '上传失败');
            }
        }

        if (completed > 0) {
            toast(targetLabel ? `已上传 ${completed} 项至「${targetLabel}」` : `已上传 ${completed} 项`);
        }
        setTimeout(() => {
            if (uploadRibbon) uploadRibbon.hidden = true;
            if (ribbonBar) ribbonBar.style.width = '0%';
        }, 500);
    }

    /* =========================================================
       8. 零卡顿极速详情检视层 (Zero-Jank Instant Viewer)
    ========================================================= */
    const viewerModal = document.getElementById('viewer-modal');
    const viewerStage = document.getElementById('viewer-stage');
    const viewerImg = document.getElementById('viewer-img');
    const viewerAmbilight = document.getElementById('viewer-ambilight');
    const btnLoadHd = document.getElementById('btn-load-hd');
    const metaTitleInput = document.getElementById('meta-title-input');
    const metaFolderInput = document.getElementById('meta-folder-input');
    const viewerFolderDot = document.getElementById('viewer-folder-dot');
    const viewerCatChipsEl = document.getElementById('viewer-cat-chips');
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
        if (viewerAmbilight) {
            viewerAmbilight.classList.remove('is-active');
        }
    }

    function renderViewerCategoryChips(currentItem) {
        if (!viewerCatChipsEl || !currentItem) return;
        const currFolder = normalizeFolder(currentItem.folder);
        const allCats = getAllCategoryNames();
        viewerCatChipsEl.innerHTML = '';

        allCats.forEach(folder => {
            const color = getCategoryColor(folder);
            const label = formatFolderDisplayName(folder);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `viewer-chip ${folder === currFolder ? 'active' : ''}`;
            chip.innerHTML = `
                <span class="cat-badge-dot" style="background:${color}; width:6px; height:6px;"></span>
                <span>${label}</span>
            `;
            chip.addEventListener('click', async () => {
                if (metaFolderInput) metaFolderInput.value = folder;
                if (viewerFolderDot) viewerFolderDot.style.background = color;
                await moveImagesToCategory([currentItem.key], folder);
                renderViewerCategoryChips(currentItem);
            });
            viewerCatChipsEl.appendChild(chip);
        });
    }

    async function upgradeViewerToOriginalHdr(item, fullUrl) {
        if (!fullUrl || !viewerImg) return;
        if (btnLoadHd) {
            btnLoadHd.hidden = false;
            btnLoadHd.textContent = 'HDR 原图加载中...';
            btnLoadHd.disabled = true;
        }
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
                if (viewerAmbilight) viewerAmbilight.src = fullUrl;
                if (btnLoadHd) btnLoadHd.hidden = true;
            }
        } catch {
            if (btnLoadHd && filteredImages[activeViewerIdx] === item) {
                btnLoadHd.textContent = `加载原图 (${formatBytes(item.size)})`;
                btnLoadHd.disabled = false;
            }
        }
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
        if (viewerAmbilight) {
            viewerAmbilight.src = fastThumb;
            viewerAmbilight.classList.add('is-active');
        }

        if (btnLoadHd) {
            if (fullUrl && fullUrl !== fastThumb) {
                btnLoadHd.hidden = false;
                btnLoadHd.textContent = `加载原图 (${formatBytes(item.size)})`;
                btnLoadHd.disabled = false;
                if (isHdrEnabled) {
                    upgradeViewerToOriginalHdr(item, fullUrl);
                }
            } else {
                btnLoadHd.hidden = true;
            }
        }

        const folderName = normalizeFolder(item.folder);
        if (metaTitleInput) metaTitleInput.value = item.title || item.originalName || '';
        if (metaFolderInput) metaFolderInput.value = folderName;
        if (viewerFolderDot) viewerFolderDot.style.background = getCategoryColor(folderName);
        renderViewerCategoryChips(item);

        document.getElementById('stat-dimensions').textContent = (item.width && item.height) ? `${item.width} × ${item.height}` : '原始比例';
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
            ['相机', ex.camera],
            ['镜头', ex.lens],
            ['焦距', ex.focal],
            ['光圈', ex.aperture],
            ['快门', ex.shutter],
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
        await upgradeViewerToOriginalHdr(item, fullUrl);
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
            if (fmt === 'url') copyText(formats.url, '直链');
            if (fmt === 'md') copyText(formats.md, 'Markdown');
            if (fmt === 'html') copyText(formats.html, 'HTML');
        });
    });

    document.getElementById('btn-save-meta')?.addEventListener('click', async () => {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;
        const newTitle = metaTitleInput.value.trim();
        const newFolder = normalizeFolder(metaFolderInput.value.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-'));

        if (newFolder && !categoryMetaMap.has(newFolder)) {
            categoryMetaMap.set(newFolder, { name: newFolder, color: getCategoryColor(newFolder) });
            saveLocalCategories();
        }

        if (isR2Connected && !item.isDemo) {
            const headers = { 'Content-Type': 'application/json' };
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            const res = await fetch('/api/images', {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    key: item.key,
                    title: newTitle,
                    folder: newFolder,
                    categories: Array.from(categoryMetaMap.values())
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                return toast(data.error || '保存失败');
            }
        }

        item.title = newTitle;
        item.folder = newFolder;
        if (isR2Connected) saveCloudSnapshot(allImages);
        else saveLocalItems();
        populateViewer();
        renderSpace();
        toast('已保存');
    });

    document.getElementById('btn-delete-single')?.addEventListener('click', async () => {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;
        if (!confirm(`确定删除「${item.title || item.originalName}」吗？`)) return;
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
       9. 设置与锁屏弹窗
    ========================================================= */
    const settingsModal = document.getElementById('settings-modal');
    const selectUploadMode = document.getElementById('select-upload-mode');
    const selectChinaCdnMode = document.getElementById('select-china-cdn-mode');
    const inputCustomDomain = document.getElementById('input-custom-domain');
    const inputNewPassword = document.getElementById('input-new-password');

    function openSettings() {
        updateStorageQuotaUI();
        updateThumbAccelStatusUI();
        if (selectUploadMode) selectUploadMode.value = uploadMode;
        if (selectChinaCdnMode) selectChinaCdnMode.value = chinaCdnMode;
        if (inputCustomDomain) inputCustomDomain.value = customDomain;
        if (inputNewPassword) inputNewPassword.value = '';
        settingsModal?.classList.add('open');
    }

    function closeSettings() {
        settingsModal?.classList.remove('open');
    }

    document.getElementById('btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('mob-btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('settings-close')?.addEventListener('click', closeSettings);
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
        uploadMode = selectUploadMode?.value || 'original';
        chinaCdnMode = selectChinaCdnMode?.value || 'smart-queue';
        customDomain = (inputCustomDomain?.value || '').trim();
        localStorage.setItem(STORAGE_KEYS.UPLOAD_MODE, uploadMode);
        localStorage.setItem(STORAGE_KEYS.CHINA_CDN_MODE, chinaCdnMode);
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
                toast('新密码已保存');
            } catch {
                toast('网络错误');
                return;
            }
        } else {
            toast('设置已保存');
        }

        closeSettings();
        renderSpace();
    });

    document.getElementById('btn-lock-now')?.addEventListener('click', () => {
        adminToken = '';
        localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.CLOUD_SNAPSHOT);
        if (lockInput) lockInput.value = '';
        closeSettings();
        showLockUI();
    });

    window.addEventListener('keydown', (e) => {
        if (!isUnlocked) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') {
            if (activeViewerIdx >= 0) closeViewer();
            else if (categoryModal?.classList.contains('open')) closeCategoryModal();
            else if (settingsModal?.classList.contains('open')) closeSettings();
            else if (quickCatPopover && !quickCatPopover.hidden) closeQuickCatPopover();
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
        updateSiteLoader(75, 'LOADING');
        tryUnlockAndLoad(adminToken, true);
    } else {
        updateSiteLoader(90, 'READY');
        showLockUI();
    }
});
