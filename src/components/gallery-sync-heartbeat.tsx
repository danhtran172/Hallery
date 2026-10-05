"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/relative-time";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";

const HEARTBEAT_MS = 60 * 1000;

/** A shared ticking clock, so "2 phút trước" ages without each label running a timer. */
let now = Date.now();
let clockListeners: (() => void)[] = [];
let clockTimer: number | undefined;
const clock = {
  subscribe(callback: () => void) {
    clockListeners.push(callback);
    if (clockTimer === undefined) {
      clockTimer = window.setInterval(() => {
        now = Date.now();
        clockListeners.forEach((listener) => listener());
      }, 30 * 1000);
    }
    return () => {
      clockListeners = clockListeners.filter((entry) => entry !== callback);
      if (clockListeners.length === 0) {
        window.clearInterval(clockTimer);
        clockTimer = undefined;
      }
    };
  },
  get: () => now,
};

/**
 * Keeps a visible Gallery's local snapshot current, and says how current it is.
 *
 * Every minute while the tab is visible it asks the server to reconcile with Notion; when
 * that reports something new, the screen refreshes in place — the scroll position and
 * anything typed into the toolbar survive, because only the server-rendered data changes.
 * The pill doubles as "sync now".
 */
export function GallerySyncHeartbeat({
  galleryId,
  syncedAt,
  renderedAt,
}: {
  galleryId: string;
  /** When the server last heard from Notion for this Gallery, as epoch ms. */
  syncedAt: number | null;
  /** The server's clock while rendering, so the first client render says the same thing. */
  renderedAt: number;
}) {
  const router = useRouter();
  const current = useSyncExternalStore(clock.subscribe, clock.get, () => renderedAt);
  const [lastSync, setLastSync] = useState(syncedAt);
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const sync = useCallback(
    async (manual: boolean) => {
      if (inFlight.current) return;
      if (!manual && document.visibilityState !== "visible") return;
      inFlight.current = true;
      if (manual) setSyncing(true);
      try {
        const response = await fetch(`/api/galleries/${galleryId}/sync`, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const result = response.ok ? ((await response.json()) as { changed?: boolean }) : null;
        setFailed(!result);
        if (result) {
          now = Date.now();
          setLastSync(now);
        }
        if (result?.changed) router.refresh();
        if (manual) {
          if (!result) toast("Chưa đồng bộ được với Notion — đang hiển thị bản lưu gần nhất.", "error");
          else toast(result.changed ? "Đã cập nhật dữ liệu mới từ Notion." : "Đã khớp với Notion — không có gì mới.");
        }
      } catch {
        // The next minute is the retry. The server has retained the last valid snapshot.
        setFailed(true);
      } finally {
        inFlight.current = false;
        if (manual) setSyncing(false);
      }
    },
    [galleryId, router],
  );

  useEffect(() => {
    let intervalId: number | undefined;

    const stop = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId);
      intervalId = undefined;
    };
    const start = () => {
      if (document.visibilityState !== "visible" || intervalId !== undefined) return;
      void sync(false);
      intervalId = window.setInterval(() => void sync(false), HEARTBEAT_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sync]);

  const label = syncing
    ? "Đang đồng bộ…"
    : failed
      ? "Chưa đồng bộ được"
      : lastSync
        ? `Cập nhật ${relativeTime(lastSync, current)}`
        : "Chưa đồng bộ";

  return (
    <button
      type="button"
      onClick={() => void sync(true)}
      disabled={syncing}
      title="Đồng bộ ngay với Notion"
      className={`group inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs transition-colors hover:bg-subtle ${
        failed ? "text-warn" : "text-muted hover:text-ink-soft"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${failed ? "bg-warn" : syncing ? "animate-pulse bg-brand" : "bg-brand/70"}`}
      />
      {label}
      <Icon name="refresh" className={`size-3.5 opacity-60 group-hover:opacity-100 ${syncing ? "animate-spin" : ""}`} />
    </button>
  );
}
