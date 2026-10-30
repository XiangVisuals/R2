/**
 * XIANG SPACE — Unified Cloudflare Worker Entrypoint (Workers + Static Assets + R2)
 * Handles:
 * - /api/images  (GET, POST, PATCH, DELETE)
 * - /raw/*       (Edge-cached R2 image delivery)
 * - /*           (Static frontend assets in public/)
 */

import {
  onRequestGet as apiGet,
  onRequestPost as apiPost,
  onRequestPatch as apiPatch,
  onRequestDelete as apiDelete,
  onRequestOptions as apiOptions,
} from "./functions/api/images.js";

import {
  onRequestGet as rawGet,
  onRequestHead as rawHead,
  onRequestOptions as rawOptions,
} from "./functions/raw/[[path]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // 1. Route: /api/images
    if (pathname === "/api/images" || pathname === "/api/images/") {
      const context = {
        request,
        env,
        params: {},
        waitUntil: (p) => ctx.waitUntil(p),
      };
      if (method === "OPTIONS") return apiOptions(context);
      if (method === "GET") return apiGet(context);
      if (method === "POST") return apiPost(context);
      if (method === "PATCH") return apiPatch(context);
      if (method === "DELETE") return apiDelete(context);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 2. Route: /raw/* (Edge-Cached Image Delivery)
    if (pathname.startsWith("/raw/")) {
      const rawPath = pathname.slice(5); // strip "/raw/"
      const pathSegments = rawPath.split("/").filter(Boolean);
      const context = {
        request,
        env,
        params: { path: pathSegments },
        waitUntil: (p) => ctx.waitUntil(p),
      };
      if (method === "OPTIONS") return rawOptions(context);
      if (method === "HEAD") return rawHead(context);
      if (method === "GET") return rawGet(context);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 3. Static Assets Fallback (Cloudflare Workers Static Assets binding)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
