/**
 * XIANGVISUALS R2 VAULT — High-Speed Edge Image Delivery & Cache Layer
 * Route: /raw/[[path]]
 * Features:
 * - Zero-cost Edge CDN caching (Cache-Control: public, max-age=31536000, immutable)
 * - ETag & If-None-Match 304 Not Modified support
 * - Range request support
 * - CORS headers for cross-origin WebGL / Canvas / Gallery usage
 */

export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!env.BUCKET) {
    return new Response("R2 Bucket binding 'BUCKET' is not configured.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const pathSegments = params.path;
  if (!pathSegments || pathSegments.length === 0) {
    return new Response("Missing object key", { status: 400 });
  }

  const key = pathSegments.map(seg => decodeURIComponent(seg)).join("/");

  // 1. Check Cloudflare Edge Cache first
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    return response;
  }

  // 2. Fetch from R2 Bucket
  const object = await env.BUCKET.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  });

  if (object === null) {
    return new Response("Object Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Timing-Allow-Origin", "*");

  if (!headers.has("Content-Type")) {
    const ext = key.split(".").pop()?.toLowerCase();
    const mimeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      avif: "image/avif",
      gif: "image/gif",
      svg: "image/svg+xml",
    };
    headers.set("Content-Type", mimeMap[ext] || "application/octet-stream");
  }

  // If 304 Not Modified (body is absent on R2Object vs R2ObjectBody)
  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }

  response = new Response(object.body, {
    status: request.headers.has("range") ? 206 : 200,
    headers,
  });

  // 3. Store in Cloudflare Edge Cache asynchronously
  if (response.status === 200) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

export async function onRequestHead(context) {
  const { env, params } = context;
  if (!env.BUCKET) return new Response(null, { status: 503 });

  const pathSegments = params.path;
  if (!pathSegments || pathSegments.length === 0) return new Response(null, { status: 400 });

  const key = pathSegments.map(seg => decodeURIComponent(seg)).join("/");
  const object = await env.BUCKET.head(key);

  if (object === null) return new Response(null, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Content-Length", object.size.toString());
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(null, { status: 200, headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
