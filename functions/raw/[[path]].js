/**
 * XIANG SPACE — High-Speed Edge Image Delivery & Cache Layer
 * Route: /raw/[[path]]
 */

function resolveBucket(env) {
  if (env.BUCKET || env.R2 || env.r2 || env.bucket) {
    return env.BUCKET || env.R2 || env.r2 || env.bucket;
  }
  if (env && typeof env === "object") {
    for (const v of Object.values(env)) {
      if (v && typeof v === "object" && typeof v.get === "function" && typeof v.put === "function") {
        return v;
      }
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const bucket = resolveBucket(env);

  if (!bucket) {
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
  if (key.startsWith(".sys/")) {
    return new Response("Forbidden", { status: 403 });
  }

  const cacheUrl = new URL(request.url);
  // Normalize cache key (strip transient retry params)
  cacheUrl.searchParams.delete("_retry");
  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET",
  });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    const ifNoneMatch = request.headers.get("if-none-match");
    const cachedEtag = response.headers.get("etag");
    if (ifNoneMatch && cachedEtag && ifNoneMatch === cachedEtag) {
      return new Response(null, { status: 304, headers: response.headers });
    }
    return response;
  }

  const object = await bucket.get(key, {
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
  // Aggressive Cloudflare CDN + Browser caching for instant repeat loads in China
  headers.set(
    "Cache-Control",
    "public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable"
  );
  headers.set("CDN-Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Timing-Allow-Origin", "*");

  if (!headers.has("Content-Type") || headers.get("Content-Type") === "application/octet-stream") {
    const ext = key.split(".").pop()?.toLowerCase();
    const mimeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      jpe: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      avif: "image/avif",
      heic: "image/heic",
      heif: "image/heif",
      hif: "image/heif",
      jxl: "image/jxl",
      tif: "image/tiff",
      tiff: "image/tiff",
      dng: "image/x-adobe-dng",
      hdr: "image/vnd.radiance",
      exr: "image/x-exr",
      gif: "image/gif",
      svg: "image/svg+xml",
    };
    headers.set("Content-Type", mimeMap[ext] || "application/octet-stream");
  }

  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }

  response = new Response(object.body, {
    status: request.headers.has("range") ? 206 : 200,
    headers,
  });

  if (response.status === 200) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

export async function onRequestHead(context) {
  const { env, params } = context;
  const bucket = resolveBucket(env);
  if (!bucket) return new Response(null, { status: 503 });

  const pathSegments = params.path;
  if (!pathSegments || pathSegments.length === 0) return new Response(null, { status: 400 });

  const key = pathSegments.map(seg => decodeURIComponent(seg)).join("/");
  const object = await bucket.head(key);

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
