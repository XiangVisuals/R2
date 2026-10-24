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

const AUTH_CONFIG_KEY = ".sys/auth.json";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Smartly resolve R2 Bucket and Admin Password from env,
 * supporting both standard names (BUCKET, ADMIN_PASSWORD), fuzzy env keys,
 * AND R2-persisted encrypted password (.sys/auth.json) so Git deploys never break auth.
 */
function resolveEnvBindings(env) {
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

  let passwordRaw =
    env.ADMIN_PASSWORD ??
    env.admin_password ??
    env.PASSWORD ??
    env.password ??
    "";

  if (!passwordRaw && env && typeof env === "object") {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" && v.trim() && /pass|token|secret|auth|pwd/i.test(k)) {
        passwordRaw = v;
        break;
      }
    }
  }

  const adminPassword = String(passwordRaw).trim();
  return { bucket, bucketBindingName, adminPassword };
}

async function readR2AuthHash(bucket) {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(AUTH_CONFIG_KEY);
    if (!obj) return null;
    const data = await obj.json();
    return data && data.passwordHash ? String(data.passwordHash) : null;
  } catch {
    return null;
  }
}

async function writeR2AuthHash(bucket, plainPassword) {
  const passwordHash = await sha256Hex(plainPassword);
  await bucket.put(
    AUTH_CONFIG_KEY,
    JSON.stringify({
      passwordHash,
      updatedAt: new Date().toISOString(),
    }),
    {
      httpMetadata: { contentType: "application/json" },
    }
  );
  return passwordHash;
}

async function verifyAdmin(request, env) {
  const { bucket, adminPassword } = resolveEnvBindings(env);
  const token = getTokenFromRequest(request);

  // 1. If ADMIN_PASSWORD is set in Cloudflare Runtime Environment Variables, verify against it
  if (adminPassword) {
    if (!token || token !== adminPassword) {
      return {
        authorized: false,
        reason: "密码错误，请重新输入 (INVALID PASSWORD)",
      };
    }
    return { authorized: true, source: "env" };
  }

  // 2. Otherwise, use R2-persisted SHA-256 password (.sys/auth.json inside the R2 bucket)
  if (bucket) {
    const storedHash = await readR2AuthHash(bucket);
    if (storedHash) {
      if (!token) {
        return {
          authorized: false,
          reason: "请输入访问密码 (PASSWORD REQUIRED)",
        };
      }
      const attemptHash = await sha256Hex(token);
      if (attemptHash !== storedHash) {
        return {
          authorized: false,
          reason: "密码错误，请重新输入 (INVALID PASSWORD)",
        };
      }
      return { authorized: true, source: "r2" };
    }

    // First-time initialization: if no password exists in env or R2 yet,
    // lock the space to the first password the owner enters and persist its SHA-256 hash in R2!
    if (!token) {
      return {
        authorized: false,
        needsFirstSetup: true,
        reason: "首次激活：输入您设置的密码即可绑定并锁定 R2 空间",
      };
    }

    await writeR2AuthHash(bucket, token);
    return {
      authorized: true,
      source: "r2-init",
      firstTimeInitialized: true,
    };
  }

  return {
    authorized: false,
    misconfigured: true,
    reason: "尚未检测到 R2 存储桶绑定 BUCKET",
  };
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
    lqip: meta.lqip || "",
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
  const r2AuthHash = hasR2 && !adminPassword ? await readR2AuthHash(bucket) : null;
  const hasPassword = Boolean(adminPassword || r2AuthHash);

  // Status probe without unlocking
  if (url.searchParams.get("action") === "status") {
    return jsonResponse({
      ok: true,
      r2Bound: hasR2,
      bucketBindingName,
      passwordConfigured: hasPassword,
      needsFirstSetup: hasR2 && !hasPassword,
    });
  }

  // 1. ALWAYS verify password first
  const auth = await verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({
      ok: false,
      r2Bound: hasR2,
      passwordConfigured: hasPassword,
      needsFirstSetup: Boolean(auth.needsFirstSetup),
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
      passwordConfigured: true,
      isAdmin: true,
      items: [],
      folders: [],
      message: "密码验证通过，但尚未检测到 R2 存储桶绑定。",
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
      passwordConfigured: true,
      firstTimeInitialized: Boolean(auth.firstTimeInitialized),
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

  const auth = await verifyAdmin(request, env);
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
    const action = (formData.get("action") || "").toString();

    // Auto-backfill thumbnail + LQIP for existing large R2 images
    if (action === "backfillThumb") {
      const targetKey = (formData.get("key") || "").toString();
      const thumbFile = formData.get("thumb");
      const lqip = (formData.get("lqip") || "").toString().slice(0, 750);
      const width = (formData.get("width") || "").toString();
      const height = (formData.get("height") || "").toString();

      if (!targetKey || !thumbFile || typeof thumbFile === "string") {
        return jsonResponse({ ok: false, error: "Missing key or thumb" }, 400);
      }

      const existing = await bucket.get(targetKey);
      if (!existing) {
        return jsonResponse({ ok: false, error: "Target object not found" }, 404);
      }

      const baseNoExt = targetKey.replace(/\.[^/.]+$/, "");
      const thumbKey = `.thumbs/${baseNoExt}.webp`;
      const thumbBuf = await thumbFile.arrayBuffer();
      await bucket.put(thumbKey, thumbBuf, {
        httpMetadata: {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
        },
      });

      const updatedMeta = {
        ...(existing.customMetadata || {}),
        thumbKey,
      };
      if (lqip) updatedMeta.lqip = lqip;
      if (width && width !== "0") updatedMeta.width = width;
      if (height && height !== "0") updatedMeta.height = height;

      await bucket.put(targetKey, existing.body, {
        httpMetadata: existing.httpMetadata,
        customMetadata: updatedMeta,
      });

      return jsonResponse({
        ok: true,
        thumbKey,
        thumbUrl: buildPublicUrl(thumbKey, request, env),
        lqip,
      });
    }

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
    const lqip = (formData.get("lqip") || "").toString().slice(0, 750);

    const customMetadata = {
      folder: rawFolder,
      originalName: originalName.slice(0, 180),
      title,
      width,
      height,
      mime: mimeType,
      exif: exifRaw,
      thumbKey,
      lqip,
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

  const auth = await verifyAdmin(request, env);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  const { bucket } = resolveEnvBindings(env);
  if (!bucket) {
    return jsonResponse({ ok: false, error: "R2 Bucket not bound" }, 503);
  }

  try {
    const body = await request.json();

    // Support changing the R2-persisted password directly from Settings
    if (body.action === "changePassword") {
      const nextPwd = String(body.newPassword || "").trim();
      if (!nextPwd || nextPwd.length < 3) {
        return jsonResponse({ ok: false, error: "新密码长度不能少于 3 位" }, 400);
      }
      await writeR2AuthHash(bucket, nextPwd);
      return jsonResponse({ ok: true, message: "密码已加密保存至 R2 存储桶" });
    }

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

  const auth = await verifyAdmin(request, env);
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
