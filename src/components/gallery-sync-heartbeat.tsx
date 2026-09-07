"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 60 * 1000;

/** Keeps a visible Gallery's local snapshot current without changing the reader's scroll position. */
export function GallerySyncHeartbeat({ galleryId }: { galleryId: string }) {
  useEffect(() => {
    let intervalId: number | undefined;
    let inFlight = false;
    let disposed = false;

    const sync = async () => {
      if (disposed || document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        await fetch(`/api/galleries/${galleryId}/sync`, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
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
  }, [galleryId]);

  return null;
}
