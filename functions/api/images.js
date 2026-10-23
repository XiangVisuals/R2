/**
 * XIANG SPACE — Cloudflare API Endpoint (/api/images)
 * Strict Authentication & R2 Binding Diagnostics
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
      "Cache-Control": "no-store, no-cache, must-revalidate",
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

/**
 * Smartly resolve R2 Bucket and Admin Password from env,
 * supporting both standard names (BUCKET, ADMIN_PASSWORD) and case/common variations.
 */
function resolveEnvBindings(env) {
  // 1. Find R2 Bucket binding (checks env.BUCKET first, then scans any binding with R2 methods)
  let bucket = env.BUCKET || env.R2 || env.r2 || env.bucket || null;
  let bucketBindingName = bucket ? "BUCKET" : null;

  if (!bucket && env && typeof env === "object") {
    for (const [k, v] of Object.entries(env)) {
      if (
        v &&
        typeof v === "object" &&
        typeof v.list === "function" &&
        typeof v.put === "function" &&
        typeof v.get === "function"
      ) {
        bucket = v;
        bucketBindingName = k;
        break;
      }
    }
  }

  // 2. Find Admin Password binding
  const passwordRaw =
    env.ADMIN_PASSWORD ??
    env.admin_password ??
    env.PASSWORD ??
    env.password ??
    "";
  const adminPassword = String(passwordRaw).trim();

  return { bucket, bucketBindingName, adminPassword };
}

function verifyAdmin(request, env) {
  const { adminPassword } = resolveEnvBindings(env);
  if (!adminPassword) {
    return {
      authorized: false,
      reason: "Cloudflare 后台尚未检测到 ADMIN_PASSWORD 变量（添加后需重新 Deploy 一次生效）",
      misconfigured: true,
    };
  }
  const token = getTokenFromRequest(request);
  if (!token || token !== adminPassword) {
    return {
      authorized: false,
      reason: "密码错误，请重新输入 (INVALID PASSWORD)",
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
  const { bucket, bucketBindingName, adminPassword } = resolveEnvBindings(env);

  const hasR2 = Boolean(bucket);
  const hasPassword = Boolean(adminPassword);

  // Status probe without unlocking
  if (url.searchParams.get("action") === "status") {
    return jsonResponse({
      ok: true,
      r2Bound: hasR2,
      bucketBindingName,
      passwordConfigured: hasPassword,
    });
  }

  // 1. ALWAYS verify password first when ADMIN_PASSWORD is set
  const auth = verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({
      ok: false,
      r2Bound: hasR2,
      passwordConfigured: hasPassword,
      locked: true,
      misconfigured: auth.misconfigured,
      message: auth.reason,
    }, 401);
  }

  // 2. Check R2 Bucket binding
  if (!hasR2) {
    return jsonResponse({
      ok: false,
      r2Bound: false,
      passwordConfigured: hasPassword,
      isAdmin: true,
      items: [],
      folders: [],
      message: "密码验证通过，但尚未检测到 R2 存储桶绑定（请在 Bindings 中绑定 BUCKET 后重新部署一次）。",
    }, 200);
  }

  try {
    const prefix = url.searchParams.get("prefix") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 800));

    const listed = await bucket.list({
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
      isAdmin: true,
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

  const { bucket } = resolveEnvBindings(env);
  if (!bucket) {
    return jsonResponse({
      ok: false,
      error: "R2 存储桶 (BUCKET) 未绑定，请在 Cloudflare 设置中绑定后重新部署一次。",
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

    if (thumbFile && typeof thumbFile !== "string") {
      thumbKey = `.thumbs/${rawFolder}/${baseName}.webp`;
      const thumbBuf = await thumbFile.arrayBuffer();
      await bucket.put(thumbKey, thumbBuf, {
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

    const putResult = await bucket.put(key, arrayBuffer, {
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

export async function onRequestPatch(context) {
  const { request, env } = context;

  const auth = verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  const { bucket } = resolveEnvBindings(env);
  if (!bucket) {
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
      const existing = await bucket.get(k);
      if (!existing) continue;

      const updatedMeta = {
        ...(existing.customMetadata || {}),
      };
      if (typeof title === "string") updatedMeta.title = title.slice(0, 120);
      if (typeof folder === "string" && folder.trim()) updatedMeta.folder = folder.trim();

      await bucket.put(k, existing.body, {
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

  const { bucket } = resolveEnvBindings(env);
  if (!bucket) {
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

    const allDeleteTargets = [...keysToDelete];
    for (const k of keysToDelete) {
      const baseNoExt = k.replace(/\.[^/.]+$/, "");
      allDeleteTargets.push(`.thumbs/${baseNoExt}.webp`);
    }

    await bucket.delete(allDeleteTargets);

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
