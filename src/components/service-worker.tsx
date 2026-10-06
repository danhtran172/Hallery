"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`, which only swaps the browser's offline page for Hallery's own.
 *
 * Production only: in `next dev` a worker would outlive every restart and keep answering
 * for a server that has moved on. Browsers expose `serviceWorker` only on HTTPS or
 * localhost, so over plain http on the Wi-Fi this quietly does nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);
  return null;
}
