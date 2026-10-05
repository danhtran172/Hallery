"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const HEARTBEAT_MS = 60 * 1000;

/**
 * Keeps a visible Gallery's local snapshot current. When the sync reports that Notion had
 * something new, the screen is refreshed in place — the scroll position and anything typed
 * into the toolbar survive, because only the server-rendered data changes.
 */
export function GallerySyncHeartbeat({ galleryId }: { galleryId: string }) {
  const router = useRouter();

  useEffect(() => {
    let intervalId: number | undefined;
    let inFlight = false;
    let disposed = false;

    const sync = async () => {
      if (disposed || document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/galleries/${galleryId}/sync`, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const result = response.ok ? ((await response.json()) as { changed?: boolean }) : null;
        if (!disposed && result?.changed) router.refresh();
      } catch {
        // The next minute is the retry. The server has retained the last valid snapshot.
      } finally {
        inFlight = false;
      }
    };

    const stop = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId);
      intervalId = undefined;
    };
    const start = () => {
      if (document.visibilityState !== "visible" || intervalId !== undefined) return;
      void sync();
      intervalId = window.setInterval(() => void sync(), HEARTBEAT_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    start();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [galleryId, router]);

  return null;
}
