/**
 * XIANG SPACE — v2.0 High-Performance Personal Image Space
 * Features:
 * 1. Entry Password Lock Screen (verifies against Cloudflare ADMIN_PASSWORD)
 * 2. Instant Progressive Viewer (0ms open using cached thumbnail + background HD swap)
 * 3. True Aspect-Ratio Uncropped Masonry Layout
 * 4. Curated Category Color Palette
 * 5. Comprehensive Batch Management (All/Invert/Move Folder/Copy URL/MD/HTML/Download/Delete)
 */

document.addEventListener("DOMContentLoaded", () => {
    const STORAGE_KEYS = {
        ADMIN_TOKEN: 'xiang_r2_token',
        CUSTOM_DOMAIN: 'xiang_r2_domain',
        UPLOAD_MODE: 'xiang_r2_upload_mode',
        LOCAL_ITEMS: 'xiang_r2_local_items'
    };

    let adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN) || '';
    let customDomain = localStorage.getItem(STORAGE_KEYS.CUSTOM_DOMAIN) || '';
    let uploadMode = localStorage.getItem(STORAGE_KEYS.UPLOAD_MODE) || 'original';

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
    let currentHdLoader = null;

    /* =========================================================
       0. 高定莫兰迪/画廊分类色彩系统 (Category Color System)
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
        '#2563eb', // Cobalt Blue
        '#059669', // Emerald
        '#d97706', // Amber Ochre
        '#7c3aed', // Violet
        '#e11d48', // Crimson Rose
        '#0891b2', // Cyan Slate
        '#4f46e5', // Indigo
        '#b45309', // Warm Bronze
        '#0d9488', // Teal
        '#9333ea'  // Purple
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

    // 本地演示种子图片（含横构图与竖构图，展示真实无裁切比例）
    const SEED_DEMO = [
        {
            key: "portfolio/IMG_0635.jpg",
            url: "https://cllli.oss-cn-beijing.aliyuncs.com/img/new/color/IMG_0635.jpg",
            size: 2845120,
            uploaded: "2026-10-20T10:30:00.000Z",
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
            uploaded: "2026-10-18T09:15:00.000Z",
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
            uploaded: "2026-10-19T14:20:00.000Z",
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
            uploaded: "2026-10-15T18:00:00.000Z",
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
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
            el.style.transition = 'opacity 0.25s ease';
            setTimeout(() => el.remove(), 260);
        }, 2200);
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
        // 1. 优先使用上传时生成的极速 WebP 缩略图 (.thumbs/...)
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
       2. 首屏密码门禁 (Password Lock Screen) 与空间初始化
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
        document.body.classList.add('locked');
        lockScreen?.classList.remove('unlocked');
        if (hintMessage && lockError) {
            lockError.textContent = hintMessage;
        }
        setTimeout(() => lockInput?.focus(), 100);
    }

    async function tryUnlockAndLoad(passwordAttempt, isInitialAutoCheck = false) {
        try {
            const headers = {};
            if (passwordAttempt) headers['Authorization'] = `Bearer ${passwordAttempt}`;

            const res = await fetch('/api/images', { headers });
            const ct = res.headers.get('content-type') || '';

            // 本地纯静态环境（没有 Pages Functions）
            if (!ct.includes('application/json')) {
                isR2Connected = false;
                if (!passwordAttempt) {
                    if (lockFooterHint) lockFooterHint.textContent = 'LOCAL DEMO MODE · 输入任意密码即可进入演示空间';
                    return false;
                }
                adminToken = passwordAttempt;
                localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
                allImages = loadLocalItems();
                if (r2ConnStatus) r2ConnStatus.textContent = 'LOCAL PREVIEW · 本地演示模式';
                unlockUI();
                renderSpace();
                return true;
            }

            const data = await res.json();
            isR2Connected = Boolean(data.r2Bound);

            // R2 尚未绑定 BUCKET
            if (!isR2Connected) {
                if (!passwordAttempt) {
                    if (lockFooterHint) lockFooterHint.textContent = 'R2 BUCKET NOT BOUND · 输入密码进入演示模式';
                    return false;
                }
                adminToken = passwordAttempt;
                localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
                allImages = loadLocalItems();
                if (r2ConnStatus) r2ConnStatus.textContent = 'R2 未绑定 BUCKET · 当前为演示模式';
                unlockUI();
                renderSpace();
                return true;
            }

            // R2 已绑定，检查是否通过密码鉴权
            if (res.status === 401 || data.locked) {
                if (!isInitialAutoCheck) {
                    if (lockError) lockError.textContent = data.message || '密码错误 (INVALID PASSWORD)';
                    lockForm?.classList.remove('shake');
                    void lockForm?.offsetWidth;
                    lockForm?.classList.add('shake');
                }
                return false;
            }

            // 如果后台尚未设置 ADMIN_PASSWORD，也要求至少在前端输入密码后才放行
            if (!data.passwordConfigured && !passwordAttempt) {
                if (lockFooterHint) lockFooterHint.textContent = '请在 Cloudflare 设置 ADMIN_PASSWORD 环境变量';
                return false;
            }

            adminToken = passwordAttempt;
            localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
            allImages = Array.isArray(data.items) ? data.items : [];
            if (r2ConnStatus) {
                r2ConnStatus.textContent = `R2 CONNECTED · 已连接云端存储桶 (${allImages.length} 张影像)`;
            }
            unlockUI();
            renderSpace();
            return true;
        } catch {
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

    // 表单提交解锁
    lockForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (lockInput?.value || '').trim();
        if (!val) {
            if (lockError) lockError.textContent = '请输入访问密码 (PLEASE ENTER PASSWORD)';
            lockForm.classList.remove('shake');
            void lockForm.offsetWidth;
            lockForm.classList.add('shake');
            return;
        }
        if (lockError) lockError.textContent = 'VERIFYING...';
        await tryUnlockAndLoad(val, false);
    });

    /* =========================================================
       3. 彩色分类标签、搜索与真实比例无裁切瀑布流 (True Masonry)
    ========================================================= */
    const folderTabsEl = document.getElementById('folder-tabs');
    const batchMoveSelect = document.getElementById('batch-move-select');
    const masonryBoardEl = document.getElementById('masonry-board');
    const emptyStageEl = document.getElementById('empty-stage');
    const storageStat = document.getElementById('storage-stat');
    const dropTargetHint = document.getElementById('drop-target-hint');

    function getColumnCount() {
        const w = window.innerWidth;
        if (w <= 640) return 2;
        if (w <= 960) return 2;
        if (w <= 1400) return 3;
        return 4;
    }

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

        // 1. ALL 标签
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

        // 2. 各彩色分类标签
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

        // 同步更新底部批量移动下拉框
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
        renderFolders();

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

        if (!masonryBoardEl || !emptyStageEl) return;

        if (filteredImages.length === 0) {
            masonryBoardEl.innerHTML = '';
            emptyStageEl.hidden = false;
            return;
        }

        emptyStageEl.hidden = true;
        masonryBoardEl.innerHTML = '';

        // 构建最短列均衡瀑布流，保持每一张图片真实原始宽高比
        const numCols = getColumnCount();
        masonryBoardEl.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;
        const colEls = [];
        const colHeights = new Array(numCols).fill(0);

        for (let c = 0; c < numCols; c++) {
            const colDiv = document.createElement('div');
            colDiv.className = 'masonry-column';
            masonryBoardEl.appendChild(colDiv);
            colEls.push(colDiv);
        }

        filteredImages.forEach((item, idx) => {
            // 寻找当前累计高度最短的一列
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
            card.style.animationDelay = `${Math.min(220, idx * 15)}ms`;

            const folderName = item.folder || 'default';
            const catColor = getCategoryColor(folderName);
            const name = item.title || item.originalName || item.key.split('/').pop();
            const info = (w && h) ? `${w}×${h}` : formatBytes(item.size);
            const fullUrl = getFullUrl(item);
            const thumbUrl = getFastThumbUrl(item);

            // 若已知真实宽高，直接设置 aspect-ratio 彻底杜绝瀑布流布局抖动 (CLS = 0)
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
                thumbWrap.classList.add('loaded');
                if ((!item.width || !item.height) && imgEl.naturalWidth && imgEl.naturalHeight) {
                    item.width = imgEl.naturalWidth;
                    item.height = imgEl.naturalHeight;
                    if (infoSpan) infoSpan.textContent = `${item.width}×${item.height}`;
                }
            };

            // 点击彩色分类微章直接过滤该分类
            card.querySelector('.cat-badge').addEventListener('click', (e) => {
                e.stopPropagation();
                currentFolder = folderName;
                renderSpace();
            });

            // 左上角复选框
            card.querySelector('.thumb-check').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelection(item.key);
            });

            // 右下角一键复制原图直链
            card.querySelector('.thumb-copy-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                copyText(fullUrl, 'URL');
            });

            // 点击图片主体：若处于批量模式则直接勾选/取消，否则 0ms 瞬开预览
            thumbWrap.addEventListener('click', () => {
                if (isBatchMode || selectedKeys.size > 0) {
                    toggleSelection(item.key);
                } else {
                    openViewer(idx, imgEl.currentSrc || thumbUrl);
                }
            });

            colEls[shortestCol].appendChild(card);
        });
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isUnlocked) renderSpace();
        }, 120);
    });

    /* =========================================================
       4. 增强版批量管理工具 (Batch Management Suite)
    ========================================================= */
    const btnBatchToggle = document.getElementById('btn-batch-toggle');
    const selectionDock = document.getElementById('selection-dock');
    const selCountEl = document.getElementById('sel-count');

    function updateSelectionCardDOM(key) {
        const card = masonryBoardEl?.querySelector(`.photo-item[data-key="${CSS.escape(key)}"]`);
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
        if (selectionDock) selectionDock.hidden = !active;
        if (selCountEl) selCountEl.textContent = `${count} SELECTED`;
    }

    function toggleSelection(key) {
        if (selectedKeys.has(key)) {
            selectedKeys.delete(key);
        } else {
            selectedKeys.add(key);
        }
        updateSelectionCardDOM(key);
        syncBatchUI();
    }

    function clearBatchMode() {
        isBatchMode = false;
        selectedKeys.clear();
        syncBatchUI();
        renderSpace();
    }

    btnBatchToggle?.addEventListener('click', () => {
        if (isBatchMode || selectedKeys.size > 0) {
            clearBatchMode();
        } else {
            isBatchMode = true;
            syncBatchUI();
            toast('BATCH MODE · 点击任意图片即可多选');
        }
    });

    // 全选
    document.getElementById('btn-sel-all')?.addEventListener('click', () => {
        const allSelected = filteredImages.every(i => selectedKeys.has(i.key));
        if (allSelected) {
            filteredImages.forEach(i => {
                selectedKeys.delete(i.key);
                updateSelectionCardDOM(i.key);
            });
        } else {
            filteredImages.forEach(i => {
                selectedKeys.add(i.key);
                updateSelectionCardDOM(i.key);
            });
        }
        syncBatchUI();
    });

    // 反选
    document.getElementById('btn-sel-invert')?.addEventListener('click', () => {
        filteredImages.forEach(i => {
            if (selectedKeys.has(i.key)) selectedKeys.delete(i.key);
            else selectedKeys.add(i.key);
            updateSelectionCardDOM(i.key);
        });
        syncBatchUI();
    });

    // 批量移动分类
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

    // 批量复制 URL / Markdown / HTML
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

    // 批量下载原图
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

    // 批量删除
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
       5. 极速双层上传引擎 (自动生成 800px WebP 缩略图 + 原图并发入库)
          保证画廊列表与点击预览永远 0 卡顿！
    ========================================================= */
    const fileInput = document.getElementById('file-input');
    const dropOverlay = document.getElementById('drop-overlay');
    const uploadRibbon = document.getElementById('upload-ribbon');
    const ribbonBar = document.getElementById('ribbon-bar');
    const ribbonText = document.getElementById('ribbon-text');
    const ribbonPercent = document.getElementById('ribbon-percent');

    document.getElementById('btn-upload')?.addEventListener('click', () => fileInput?.click());
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

        // 1. 生成轻量级 800px WebP 缩略图 (~30KB)，供瀑布流与瞬开预览使用
        let thumbBlob = null;
        if (file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
            const thumbMax = 840;
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
            thumbBlob = await new Promise(r => tCanvas.toBlob(r, 'image/webp', 0.80));
        }

        // 2. 处理主文件（保留原图或按设置转 WebP）
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
       6. 零延迟渐进式详情检视层 (0ms Instant Progressive Viewer)
          点击卡片瞬间先显示内存里已加载好的缩略图，同时后台静默加载高清原图无缝替换！
          并且自动预加载左右相邻两张图片，徹底解决点开大图卡几秒的问题。
    ========================================================= */
    const viewerModal = document.getElementById('viewer-modal');
    const viewerImg = document.getElementById('viewer-img');
    const hdLoadingPill = document.getElementById('hd-loading-pill');
    const metaTitleInput = document.getElementById('meta-title-input');
    const metaFolderInput = document.getElementById('meta-folder-input');
    const viewerFolderDot = document.getElementById('viewer-folder-dot');
    const exifBlock = document.getElementById('exif-block');
    const exifList = document.getElementById('exif-list');

    function openViewer(idx, instantPreviewSrc = null) {
        if (filteredImages.length === 0) return;
        activeViewerIdx = ((idx % filteredImages.length) + filteredImages.length) % filteredImages.length;
        document.body.style.overflow = 'hidden';
        viewerModal?.classList.add('open');
        populateViewer(instantPreviewSrc);
    }

    function closeViewer() {
        activeViewerIdx = -1;
        if (currentHdLoader) {
            currentHdLoader.onload = null;
            currentHdLoader = null;
        }
        if (hdLoadingPill) hdLoadingPill.hidden = true;
        document.body.style.overflow = '';
        viewerModal?.classList.remove('open');
    }

    function populateViewer(instantPreviewSrc = null) {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;

        const fullUrl = getFullUrl(item);
        const fastThumb = instantPreviewSrc || getFastThumbUrl(item);
        const formats = buildFormats(item);

        // 1. 0ms 立即显示浏览器已缓存的缩略图，绝不白屏等待！
        if (viewerImg) {
            viewerImg.src = fastThumb;
        }

        // 2. 如果原图 URL 与缩略图不同，则在后台静默加载高清原图，加载完后无缝替换
        if (currentHdLoader) {
            currentHdLoader.onload = null;
            currentHdLoader = null;
        }
        if (fullUrl && fullUrl !== fastThumb) {
            if (hdLoadingPill) hdLoadingPill.hidden = false;
            const hdImg = new Image();
            currentHdLoader = hdImg;
            hdImg.onload = () => {
                if (currentHdLoader === hdImg && viewerImg) {
                    viewerImg.src = fullUrl;
                    if (hdLoadingPill) hdLoadingPill.hidden = true;
                    if ((!item.width || !item.height) && hdImg.naturalWidth) {
                        item.width = hdImg.naturalWidth;
                        item.height = hdImg.naturalHeight;
                        document.getElementById('stat-dimensions').textContent = `${item.width} × ${item.height}`;
                    }
                }
            };
            hdImg.onerror = () => {
                if (hdLoadingPill) hdLoadingPill.hidden = true;
            };
            hdImg.src = fullUrl;
        } else {
            if (hdLoadingPill) hdLoadingPill.hidden = true;
        }

        // 3. 预热左右相邻图片缩略图
        if (filteredImages.length > 1) {
            const nextItem = filteredImages[(activeViewerIdx + 1) % filteredImages.length];
            const prevItem = filteredImages[(activeViewerIdx - 1 + filteredImages.length) % filteredImages.length];
            new Image().src = getFastThumbUrl(nextItem);
            new Image().src = getFastThumbUrl(prevItem);
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

    document.getElementById('viewer-prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (filteredImages.length === 0) return;
        activeViewerIdx = (activeViewerIdx - 1 + filteredImages.length) % filteredImages.length;
        populateViewer();
    });
    document.getElementById('viewer-next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (filteredImages.length === 0) return;
        activeViewerIdx = (activeViewerIdx + 1) % filteredImages.length;
        populateViewer();
    });
    document.getElementById('viewer-close')?.addEventListener('click', closeViewer);
    document.getElementById('viewer-stage')?.addEventListener('click', (e) => {
        if (e.target.id === 'viewer-stage') closeViewer();
    });

    /* =========================================================
       7. 空间设置与一键锁屏弹窗
    ========================================================= */
    const settingsModal = document.getElementById('settings-modal');
    const selectUploadMode = document.getElementById('select-upload-mode');
    const inputCustomDomain = document.getElementById('input-custom-domain');

    function openSettings() {
        if (selectUploadMode) selectUploadMode.value = uploadMode;
        if (inputCustomDomain) inputCustomDomain.value = customDomain;
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

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
        uploadMode = selectUploadMode?.value || 'original';
        customDomain = (inputCustomDomain?.value || '').trim();
        localStorage.setItem(STORAGE_KEYS.UPLOAD_MODE, uploadMode);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DOMAIN, customDomain);
        closeSettings();
        renderSpace();
        toast('SETTINGS SAVED');
    });

    // 立即锁屏按钮：清除本地保存的密码并回到首屏密码门禁
    document.getElementById('btn-lock-now')?.addEventListener('click', () => {
        adminToken = '';
        localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
        if (lockInput) lockInput.value = '';
        closeSettings();
        showLockUI();
    });

    // 键盘快捷键 (Esc / 左右箭头 / B 开启批量模式)
    window.addEventListener('keydown', (e) => {
        if (!isUnlocked) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') {
            if (activeViewerIdx >= 0) closeViewer();
            else if (settingsModal?.classList.contains('open')) closeSettings();
            else if (isBatchMode || selectedKeys.size > 0) clearBatchMode();
        } else if (activeViewerIdx >= 0) {
            if (e.key === 'ArrowLeft') document.getElementById('viewer-prev')?.click();
            if (e.key === 'ArrowRight') document.getElementById('viewer-next')?.click();
        } else if (e.key === 'b' || e.key === 'B') {
            btnBatchToggle?.click();
        }
    });

    // 启动时检查是否已缓存有效密码，若未保存或验证失败则停留在首屏密码门禁
    if (adminToken) {
        tryUnlockAndLoad(adminToken, true);
    } else {
        showLockUI();
    }
});
