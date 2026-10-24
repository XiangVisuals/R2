/**
 * 向 · 私人影像馆 — 本地持久化极速缓存引擎 (Service Worker)
 * 专为中国大陆网络环境优化：
 * 1. 所有已加载过的 /raw/ 缩略图与原图永久存入本地 CacheStorage，二次访问 0ms 磁盘直出，彻底免除跨洋请求
 * 2. 静态资源 (HTML/CSS/JS) 采用网络优先 + 离线回退策略，确保弱网环境下依然秒开
 */

const IMG_CACHE_NAME = 'xiang-r2-images-v4';
const STATIC_CACHE_NAME = 'xiang-r2-static-v4';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((k) => {
                    if (k !== IMG_CACHE_NAME && k !== STATIC_CACHE_NAME) {
                        return caches.delete(k);
                    }
                })
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 1. 针对 /raw/ 图片请求（含缩略图）：本地缓存优先 (Cache-First)，命中即 0ms 返回
    if (url.pathname.startsWith('/raw/')) {
        event.respondWith(
            caches.open(IMG_CACHE_NAME).then(async (cache) => {
                // 忽略 _retry 重试参数以最大化缓存命中率
                const cleanUrl = new URL(req.url);
                cleanUrl.searchParams.delete('_retry');
                const cacheKey = cleanUrl.toString();

                const cached = await cache.match(cacheKey);
                if (cached) {
                    return cached;
                }

                const networkRes = await fetch(req);
                if (networkRes && networkRes.status === 200) {
                    cache.put(cacheKey, networkRes.clone());
                }
                return networkRes;
            })
        );
        return;
    }

    // 2. 针对同源静态资源 (CSS / JS)：Stale-While-Revalidate 瞬间响应并后台更新
    if (url.origin === self.location.origin && (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/'))) {
        event.respondWith(
            caches.open(STATIC_CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(req);
                const fetchPromise = fetch(req).then((networkRes) => {
                    if (networkRes && networkRes.status === 200) {
                        cache.put(req, networkRes.clone());
                    }
                    return networkRes;
                }).catch(() => cached);
                return cached || fetchPromise;
            })
        );
    }
});
