/**
 * XIANG — Minimalist Personal Image Space
 * Pure, distraction-free image management powered by Cloudflare R2
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
    let isAdminVerified = false;
    let allImages = [];
    let filteredImages = [];
    let currentFolder = 'all';
    let customFolders = new Set();
    let searchQuery = '';
    let selectedKeys = new Set();
    let activeViewerIdx = -1;

    // 默认内置 4 张干净的示例影像（仅在尚未连接 R2 且本地为空时展示，随时可删）
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
       1. 基础工具函数
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

    function getThumbUrl(rawUrl, maxEdge = 900) {
        if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
        if (rawUrl.includes('aliyuncs.com') && !rawUrl.includes('x-oss-process')) {
            return `${rawUrl}?x-oss-process=image/resize,l_${maxEdge},limit_1/auto-orient,1/quality,q_85/format,jpg`;
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

    /* =========================================================
       2. 数据加载与状态同步
    ========================================================= */
    const authDot = document.getElementById('auth-dot');
    const storageStat = document.getElementById('storage-stat');
    const r2ConnStatus = document.getElementById('r2-conn-status');

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

    async function loadSpace() {
        try {
            const headers = {};
            if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
            const res = await fetch('/api/images', { headers });
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) throw new Error('local');

            const data = await res.json();
            isR2Connected = Boolean(data.r2Bound);
            isAdminVerified = Boolean(data.isAdmin);

            if (isR2Connected) {
                allImages = Array.isArray(data.items) ? data.items : [];
                if (authDot) {
                    authDot.className = 'status-dot ' + (isAdminVerified ? 'online' : 'locked');
                }
                if (r2ConnStatus) {
                    r2ConnStatus.textContent = isAdminVerified
                        ? 'R2 CONNECTED · 已连接云端存储桶 (管理员已解锁)'
                        : 'R2 CONNECTED · 访客只读模式 (输入密钥可上传/删除)';
                }
            } else {
                allImages = loadLocalItems();
                if (r2ConnStatus) {
                    r2ConnStatus.textContent = 'LOCAL PREVIEW · 本地演示模式 (绑定 Cloudflare R2 BUCKET 后自动切换云端)';
                }
            }
        } catch {
            isR2Connected = false;
            allImages = loadLocalItems();
            if (r2ConnStatus) {
                r2ConnStatus.textContent = 'LOCAL PREVIEW · 本地演示模式 (绑定 Cloudflare R2 BUCKET 后自动切换云端)';
            }
        }

        renderSpace();
    }

    /* =========================================================
       3. 文件夹导航、搜索与极简网格渲染
    ========================================================= */
    const folderTabsEl = document.getElementById('folder-tabs');
    const photoGridEl = document.getElementById('photo-grid');
    const emptyStageEl = document.getElementById('empty-stage');
    const dropTargetHint = document.getElementById('drop-target-hint');

    function renderFolders() {
        if (!folderTabsEl) return;
        const folderSet = new Set();
        allImages.forEach(item => {
            if (item.folder && item.folder !== 'default') folderSet.add(item.folder);
        });
        customFolders.forEach(f => folderSet.add(f));

        const folders = ['all', ...Array.from(folderSet)];
        if (allImages.some(i => !i.folder || i.folder === 'default') && !folders.includes('default')) {
            folders.splice(1, 0, 'default');
        }

        folderTabsEl.innerHTML = '';
        folders.forEach(folder => {
            const btn = document.createElement('button');
            btn.className = `tab-item ${currentFolder === folder ? 'active' : ''}`;
            btn.textContent = folder.toUpperCase();
            btn.addEventListener('click', () => {
                currentFolder = folder;
                renderSpace();
            });
            folderTabsEl.appendChild(btn);
        });

        if (dropTargetHint) {
            const target = currentFolder === 'all' ? 'default' : currentFolder;
            dropTargetHint.textContent = `松开鼠标上传至 [${target.toUpperCase()}]`;
        }
    }

    // 新建分类文件夹按钮
    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
        const name = prompt('输入新的分类目录名称 (例如: 2026, work, blog):');
        if (!name) return;
        const clean = name.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-');
        if (!clean) return;
        customFolders.add(clean);
        currentFolder = clean;
        renderSpace();
        toast(`FOLDER: ${clean.toUpperCase()}`);
    });

    // 搜索过滤
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderSpace();
    });

    function renderSpace() {
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

        if (!photoGridEl || !emptyStageEl) return;

        if (filteredImages.length === 0) {
            photoGridEl.innerHTML = '';
            emptyStageEl.hidden = false;
            return;
        }

        emptyStageEl.hidden = true;
        photoGridEl.innerHTML = '';

        filteredImages.forEach((item, idx) => {
            const card = document.createElement('div');
            const isSelected = selectedKeys.has(item.key);
            card.className = `photo-item ${isSelected ? 'selected' : ''}`;
            card.style.animationDelay = `${Math.min(240, idx * 18)}ms`;

            const name = item.title || item.originalName || item.key.split('/').pop();
            const info = (item.width && item.height) ? `${item.width}×${item.height}` : formatBytes(item.size);
            const fullUrl = getFullUrl(item);

            card.innerHTML = `
                <div class="photo-thumb-wrap">
                    <button type="button" class="thumb-check" title="选择">${isSelected ? '✓' : ''}</button>
                    <img src="${getThumbUrl(fullUrl, 800)}" alt="${name}" loading="lazy">
                    <button type="button" class="thumb-copy-btn" title="复制直链 URL">COPY</button>
                </div>
                <div class="photo-caption">
                    <span class="caption-name">${name}</span>
                    <span class="caption-info">${info}</span>
                </div>
            `;

            const thumbWrap = card.querySelector('.photo-thumb-wrap');
            const imgEl = card.querySelector('img');
            imgEl.onload = () => {
                if (!item.width && imgEl.naturalWidth) {
                    item.width = imgEl.naturalWidth;
                    item.height = imgEl.naturalHeight;
                }
            };

            // 左上角复选框
            card.querySelector('.thumb-check').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelection(item.key);
            });

            // 右下角一键复制 URL
            card.querySelector('.thumb-copy-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                copyText(fullUrl, 'URL');
            });

            // 点击图片：如果当前处于多选状态则切换选中，否则打开干净的预览层
            thumbWrap.addEventListener('click', () => {
                if (selectedKeys.size > 0) {
                    toggleSelection(item.key);
                } else {
                    openViewer(idx);
                }
            });

            photoGridEl.appendChild(card);
        });
    }

    /* =========================================================
       4. 极简多选与底部胶囊栏 (Selection Dock)
    ========================================================= */
    const selectionDock = document.getElementById('selection-dock');
    const selCountEl = document.getElementById('sel-count');

    function toggleSelection(key) {
        if (selectedKeys.has(key)) {
            selectedKeys.delete(key);
        } else {
            selectedKeys.add(key);
        }
        syncSelectionUI();
    }

    function clearSelection() {
        selectedKeys.clear();
        syncSelectionUI();
    }

    function syncSelectionUI() {
        const count = selectedKeys.size;
        document.body.classList.toggle('has-selection', count > 0);
        if (selectionDock) {
            selectionDock.hidden = count === 0;
        }
        if (selCountEl) {
            selCountEl.textContent = `${count} SELECTED`;
        }
        renderSpace();
    }

    document.getElementById('btn-sel-all')?.addEventListener('click', () => {
        const allInFilterSelected = filteredImages.every(i => selectedKeys.has(i.key));
        if (allInFilterSelected) {
            filteredImages.forEach(i => selectedKeys.delete(i.key));
        } else {
            filteredImages.forEach(i => selectedKeys.add(i.key));
        }
        syncSelectionUI();
    });

    document.getElementById('btn-sel-copy-url')?.addEventListener('click', () => {
        const urls = allImages.filter(i => selectedKeys.has(i.key)).map(i => getFullUrl(i)).join('\n');
        copyText(urls, `${selectedKeys.size} URLS`);
    });

    document.getElementById('btn-sel-copy-md')?.addEventListener('click', () => {
        const mds = allImages.filter(i => selectedKeys.has(i.key)).map(i => buildFormats(i).md).join('\n');
        copyText(mds, `${selectedKeys.size} MARKDOWN`);
    });

    document.getElementById('btn-sel-delete')?.addEventListener('click', async () => {
        const keys = Array.from(selectedKeys);
        if (keys.length === 0) return;
        if (!confirm(`确定删除选中的 ${keys.length} 张图片吗？`)) return;
        const ok = await deleteImages(keys);
        if (ok) clearSelection();
    });

    document.getElementById('btn-sel-clear')?.addEventListener('click', clearSelection);

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
                if (res.status === 401) openSettings();
                toast(data.error || '需要管理员密钥');
                return false;
            }
        }
        const delSet = new Set(keys);
        allImages = allImages.filter(i => !delSet.has(i.key));
        if (!isR2Connected) saveLocalItems();
        renderSpace();
        toast(`DELETED ${keys.length}`);
        return true;
    }

    /* =========================================================
       5. 无感上传引擎 (点击 + UPLOAD / 全屏拖拽 / ⌘V 粘贴)
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

    // 全屏拖拽识别
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
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
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length) uploadFiles(files);
    });

    // 全局 Ctrl+V / Cmd+V 粘贴上传
    window.addEventListener('paste', (e) => {
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

    async function prepareImage(file) {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            const u = URL.createObjectURL(file);
            el.onload = () => { URL.revokeObjectURL(u); resolve(el); };
            el.onerror = reject;
            el.src = u;
        });

        let width = img.naturalWidth || 1920;
        let height = img.naturalHeight || 1080;

        if (uploadMode === 'original' || file.type === 'image/svg+xml' || file.type === 'image/gif') {
            return { file, width, height };
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
        return { file: out, width, height };
    }

    async function uploadFiles(files) {
        const targetFolder = currentFolder === 'all' ? 'default' : currentFolder;
        if (uploadRibbon) uploadRibbon.hidden = false;

        let completed = 0;
        const total = files.length;

        for (const rawFile of files) {
            if (ribbonText) ribbonText.textContent = `Uploading ${rawFile.name} (${completed + 1}/${total})...`;
            const pct = Math.round(((completed + 0.3) / total) * 100);
            if (ribbonBar) ribbonBar.style.width = `${pct}%`;
            if (ribbonPercent) ribbonPercent.textContent = `${pct}%`;

            try {
                const [exif, { file, width, height }] = await Promise.all([
                    parseExif(rawFile),
                    prepareImage(rawFile)
                ]);

                let newItem = null;

                if (isR2Connected) {
                    const fd = new FormData();
                    fd.append('file', file);
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
                        if (res.status === 401) openSettings();
                        throw new Error(data.error || 'Upload failed');
                    }
                    newItem = data.item;
                } else {
                    const dataUrl = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onload = () => r(reader.result);
                        reader.readAsDataURL(file);
                    });
                    newItem = {
                        key: `${targetFolder}/${Date.now()}-${file.name}`,
                        url: dataUrl,
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
        }, 600);
    }

    /* =========================================================
       6. 极简详情检视层 (Viewer Modal)
    ========================================================= */
    const viewerModal = document.getElementById('viewer-modal');
    const viewerImg = document.getElementById('viewer-img');
    const metaTitleInput = document.getElementById('meta-title-input');
    const metaFolderInput = document.getElementById('meta-folder-input');
    const exifBlock = document.getElementById('exif-block');
    const exifList = document.getElementById('exif-list');

    function openViewer(idx) {
        if (filteredImages.length === 0) return;
        activeViewerIdx = ((idx % filteredImages.length) + filteredImages.length) % filteredImages.length;
        document.body.style.overflow = 'hidden';
        viewerModal?.classList.add('open');
        populateViewer();
    }

    function closeViewer() {
        activeViewerIdx = -1;
        document.body.style.overflow = '';
        viewerModal?.classList.remove('open');
    }

    function populateViewer() {
        const item = filteredImages[activeViewerIdx];
        if (!item) return;

        const fullUrl = getFullUrl(item);
        const formats = buildFormats(item);

        if (viewerImg) viewerImg.src = getThumbUrl(fullUrl, 1800);
        if (metaTitleInput) metaTitleInput.value = item.title || item.originalName || '';
        if (metaFolderInput) metaFolderInput.value = item.folder || 'default';

        document.getElementById('stat-dimensions').textContent = (item.width && item.height) ? `${item.width} × ${item.height}` : 'IMAGE';
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

        // 仅当存在有效 EXIF 字段时才显示 EXIF 区域
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

    // 点击整行复制对应格式
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

    // 保存标题或分类修改
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
                if (res.status === 401) openSettings();
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
       7. 极简设置弹窗 (Settings Modal)
    ========================================================= */
    const settingsModal = document.getElementById('settings-modal');
    const inputAdminToken = document.getElementById('input-admin-token');
    const selectUploadMode = document.getElementById('select-upload-mode');
    const inputCustomDomain = document.getElementById('input-custom-domain');

    function openSettings() {
        if (inputAdminToken) inputAdminToken.value = adminToken;
        if (selectUploadMode) selectUploadMode.value = uploadMode;
        if (inputCustomDomain) inputCustomDomain.value = customDomain;
        settingsModal?.classList.add('open');
    }

    function closeSettings() {
        settingsModal?.classList.remove('open');
    }

    document.getElementById('btn-auth')?.addEventListener('click', openSettings);
    document.getElementById('settings-close')?.addEventListener('click', closeSettings);
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
        adminToken = (inputAdminToken?.value || '').trim();
        uploadMode = selectUploadMode?.value || 'original';
        customDomain = (inputCustomDomain?.value || '').trim();

        localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken);
        localStorage.setItem(STORAGE_KEYS.UPLOAD_MODE, uploadMode);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DOMAIN, customDomain);

        closeSettings();
        await loadSpace();
        toast('SETTINGS SAVED');
    });

    document.getElementById('btn-logout')?.addEventListener('click', () => {
        adminToken = '';
        localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
        if (inputAdminToken) inputAdminToken.value = '';
        closeSettings();
        loadSpace();
        toast('LOGGED OUT');
    });

    // 键盘快捷键 (Esc 关闭 / 左右键切换图片)
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') {
            if (activeViewerIdx >= 0) closeViewer();
            else if (settingsModal?.classList.contains('open')) closeSettings();
            else if (selectedKeys.size > 0) clearSelection();
        } else if (activeViewerIdx >= 0) {
            if (e.key === 'ArrowLeft') document.getElementById('viewer-prev')?.click();
            if (e.key === 'ArrowRight') document.getElementById('viewer-next')?.click();
        }
    });

    loadSpace();
});
