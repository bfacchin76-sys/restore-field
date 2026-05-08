"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on first paint, in production only. Kept tiny so it
 * doesn't add to first-paint cost.
 *
 * Dev caveat: a stale service worker can mask source changes — we
 * deliberately skip registration in development. Test the SW with
 * `pnpm build && pnpm start`.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const url = "/sw.js";
    navigator.serviceWorker
      .register(url, { scope: "/" })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });
  }, []);
  return null;
}
