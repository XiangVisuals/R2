/**
 * XIANG SPACE — Cloudflare Pages Function (/api/images)
 *
 * Methods:
 * - GET: List images in R2 (or ?action=verify to verify admin password)
 * - POST: Upload single or multiple images with optional client-generated thumbnail
 * - PATCH: Batch or single update of folder (category) & title metadata
 * - DELETE: Batch or single delete of images (plus their thumbnails & edge cache)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function getTokenFromRequest(request) {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return (request.headers.get("X-Admin-Token") || "").trim();
}

function verifyAdmin(request, env) {
  const configuredPassword = env.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return {
      authorized: false,
      reason: "服务器端尚未配置 ADMIN_PASSWORD 环境变量，请在 Cloudflare Pages -> Settings -> Environment variables 中设置。",
      misconfigured: true,
    };
  }
  const token = getTokenFromRequest(request);
  if (!token || token !== configuredPassword) {
    return {
      authorized: false,
      reason: "访问密钥不正确 (INVALID PASSWORD)",
      misconfigured: false,
    };
  }
  return { authorized: true };
}

function buildPublicUrl(key, request, env) {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const customDomain = (env.PUBLIC_R2_DOMAIN || "").trim().replace(/\/+$/, "");
  if (customDomain) {
    return `${customDomain}/${encodedKey}`;
  }
  const origin = new URL(request.url).origin;
  return `${origin}/raw/${encodedKey}`;
}

function formatR2Object(obj, request, env) {
  const meta = obj.customMetadata || {};
  let exif = {};
  if (meta.exif) {
    try {
      exif = JSON.parse(meta.exif);
    } catch {
      exif = {};
    }
  }

  const fullUrl = buildPublicUrl(obj.key, request, env);
  const thumbUrl = meta.thumbKey ? buildPublicUrl(meta.thumbKey, request, env) : fullUrl;

  return {
    key: obj.key,
    url: fullUrl,
    thumbUrl,
    thumbKey: meta.thumbKey || "",
    size: obj.size,
    uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : new Date().toISOString(),
    etag: obj.httpEtag,
    folder: meta.folder || (obj.key.includes("/") ? obj.key.split("/")[0] : "default"),
    originalName: meta.originalName || obj.key.split("/").pop(),
    title: meta.title || meta.originalName || obj.key.split("/").pop(),
    width: meta.width ? Number(meta.width) : 0,
    height: meta.height ? Number(meta.height) : 0,
    mime: meta.mime || (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg",
    exif,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  const hasR2 = Boolean(env.BUCKET);
  const hasPassword = Boolean(env.ADMIN_PASSWORD);

  if (action === "verify") {
    const auth = verifyAdmin(request, env);
    return jsonResponse({
      ok: auth.authorized,
      r2Bound: hasR2,
      passwordConfigured: hasPassword,
      publicDomain: env.PUBLIC_R2_DOMAIN || new URL(request.url).origin + "/raw",
      message: auth.authorized ? "VERIFIED" : auth.reason,
    }, auth.authorized ? 200 : 401);
  }

  if (!hasR2) {
    return jsonResponse({
      ok: false,
      r2Bound: false,
      passwordConfigured: hasPassword,
      items: [],
      folders: [],
      message: "未检测到 R2 存储桶绑定 (BUCKET)。",
    }, 200);
  }

  const auth = verifyAdmin(request, env);
  if (hasPassword && !auth.authorized) {
    return jsonResponse({
      ok: false,
      r2Bound: true,
      passwordConfigured: true,
      isAdmin: false,
      locked: true,
      items: [],
      message: auth.reason,
    }, 401);
  }

  try {
    const prefix = url.searchParams.get("prefix") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 800));

    const listed = await env.BUCKET.list({
      prefix,
      cursor,
      limit,
      include: ["httpMetadata", "customMetadata"],
    });

    const items = (listed.objects || [])
      .filter((obj) => !obj.key.endsWith("/.keep") && !obj.key.startsWith(".sys/") && !obj.key.startsWith(".thumbs/"))
      .map((obj) => formatR2Object(obj, request, env))
      .sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());

    const folderSet = new Set(["default"]);
    items.forEach((item) => {
      if (item.folder) folderSet.add(item.folder);
    });

    return jsonResponse({
      ok: true,
      r2Bound: true,
      passwordConfigured: hasPassword,
      isAdmin: auth.authorized,
      publicDomain: env.PUBLIC_R2_DOMAIN || new URL(request.url).origin + "/raw",
      items,
      folders: Array.from(folderSet),
      truncated: listed.truncated || false,
      cursor: listed.cursor || null,
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      r2Bound: true,
      error: err.message || "Failed to list R2 objects",
    }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  if (!env.BUCKET) {
    return jsonResponse({
      ok: false,
      error: "R2 存储桶 (BUCKET) 未绑定，请在 Cloudflare Pages -> Settings -> Functions -> R2 bucket bindings 中添加变量名 BUCKET。",
    }, 503);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const thumbFile = formData.get("thumb");

    if (!file || typeof file === "string") {
      return jsonResponse({ ok: false, error: "未收到有效的文件数据 (Missing file)" }, 400);
    }

    const rawFolder = (formData.get("folder") || "default")
      .toString()
      .trim()
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "default";

    const originalName = (file.name || "image.jpg").toString();
    const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
    const mimeType = file.type || "image/jpeg";
    const fallbackExt = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const ext = (extMatch ? extMatch[1] : fallbackExt).toLowerCase();

    const customSlug = (formData.get("customName") || "")
      .toString()
      .trim()
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "-");

    const now = new Date();
    const datePrefix = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("");
    const randSuffix = Math.random().toString(36).substring(2, 7);

    const baseName = customSlug
      ? `${datePrefix}-${customSlug}-${randSuffix}`
      : `${datePrefix}-${randSuffix}`;

    const key = `${rawFolder}/${baseName}.${ext}`;
    let thumbKey = "";

    // If client provided a lightweight WebP thumbnail, store it under .thumbs/ for instant loading
    if (thumbFile && typeof thumbFile !== "string") {
      thumbKey = `.thumbs/${rawFolder}/${baseName}.webp`;
      const thumbBuf = await thumbFile.arrayBuffer();
      await env.BUCKET.put(thumbKey, thumbBuf, {
        httpMetadata: {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    }

    const width = (formData.get("width") || "0").toString();
    const height = (formData.get("height") || "0").toString();
    const title = (formData.get("title") || originalName.replace(/\.[^/.]+$/, "")).toString().slice(0, 120);
    const exifRaw = (formData.get("exif") || "{}").toString().slice(0, 1500);

    const customMetadata = {
      folder: rawFolder,
      originalName: originalName.slice(0, 180),
      title,
      width,
      height,
      mime: mimeType,
      exif: exifRaw,
      thumbKey,
      uploadedAt: now.toISOString(),
    };

    const arrayBuffer = await file.arrayBuffer();

    const putResult = await env.BUCKET.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata,
    });

    const item = formatR2Object(
      {
        key,
        size: arrayBuffer.byteLength,
        uploaded: now,
        httpEtag: putResult?.httpEtag || "",
        httpMetadata: { contentType: mimeType },
        customMetadata,
      },
      request,
      env
    );

    return jsonResponse({ ok: true, item }, 201);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err.message || "上传至 R2 失败",
    }, 500);
  }
}

/**
 * PATCH /api/images
 * Supports single { key, title, folder } OR batch { keys: [...], folder }
 */
export async function onRequestPatch(context) {
  const { request, env } = context;

  const auth = verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  if (!env.BUCKET) {
    return jsonResponse({ ok: false, error: "R2 Bucket not bound" }, 503);
  }

  try {
    const body = await request.json();
    const keys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
    const { title, folder } = body;

    if (keys.length === 0) {
      return jsonResponse({ ok: false, error: "Missing key(s)" }, 400);
    }

    const updatedItems = [];

    for (const k of keys) {
      const existing = await env.BUCKET.get(k);
      if (!existing) continue;

      const updatedMeta = {
        ...(existing.customMetadata || {}),
      };
      if (typeof title === "string") updatedMeta.title = title.slice(0, 120);
      if (typeof folder === "string" && folder.trim()) updatedMeta.folder = folder.trim();

      await env.BUCKET.put(k, existing.body, {
        httpMetadata: existing.httpMetadata,
        customMetadata: updatedMeta,
      });

      updatedItems.push(
        formatR2Object(
          {
            key: k,
            size: existing.size,
            uploaded: existing.uploaded,
            httpEtag: existing.httpEtag,
            httpMetadata: existing.httpMetadata,
            customMetadata: updatedMeta,
          },
          request,
          env
        )
      );
    }

    return jsonResponse({ ok: true, items: updatedItems, item: updatedItems[0] || null });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || "Update failed" }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  const auth = verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  if (!env.BUCKET) {
    return jsonResponse({ ok: false, error: "R2 Bucket not bound" }, 503);
  }

  try {
    const url = new URL(request.url);
    const queryKey = url.searchParams.get("key");
    let keysToDelete = [];

    if (queryKey) {
      keysToDelete.push(queryKey);
    } else {
      const body = await request.json().catch(() => ({}));
      if (Array.isArray(body.keys)) {
        keysToDelete = body.keys.filter(Boolean);
      } else if (body.key) {
        keysToDelete = [body.key];
      }
    }

    if (keysToDelete.length === 0) {
      return jsonResponse({ ok: false, error: "未指定要删除的文件 Key" }, 400);
    }

    // Also delete associated .thumbs/ objects
    const allDeleteTargets = [...keysToDelete];
    for (const k of keysToDelete) {
      const baseNoExt = k.replace(/\.[^/.]+$/, "");
      allDeleteTargets.push(`.thumbs/${baseNoExt}.webp`);
    }

    await env.BUCKET.delete(allDeleteTargets);

    const cache = caches.default;
    const origin = new URL(request.url).origin;
    for (const k of allDeleteTargets) {
      const encoded = k.split("/").map(encodeURIComponent).join("/");
      const rawUrl = `${origin}/raw/${encoded}`;
      context.waitUntil(cache.delete(rawUrl));
    }

    return jsonResponse({
      ok: true,
      deleted: keysToDelete,
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err.message || "Delete failed",
    }, 500);
  }
}
