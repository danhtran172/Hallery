"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";

type Toast = { id: number; message: string; tone: "info" | "error" };

let toasts: Toast[] = [];
let listeners: (() => void)[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((callback) => callback());
}

function dismiss(id: number) {
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

/**
 * A short message in the corner — for actions that happen away from any form, where there
 * is nowhere else to say that something worked or did not (sidebar moves, trash, sync).
 */
export function toast(message: string, tone: Toast["tone"] = "info") {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, message, tone }];
  emit();
  window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
}

// One shared empty list: React compares snapshots by identity, and a fresh [] per call reads
// as a store that never settles.
const NONE: Toast[] = [];

const store = {
  subscribe(callback: () => void) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((entry) => entry !== callback);
    };
  },
  get: () => toasts,
  getServer: () => NONE,
};

export function Toaster() {
  const list = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  if (list.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
    >
      {list.map((entry) => (
        <div
          key={entry.id}
          role={entry.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-sm animate-rise-in items-start gap-2.5 rounded-2xl px-4 py-3 text-sm shadow-pop ring-1 ${
            entry.tone === "error" ? "bg-danger-soft text-danger ring-danger/20" : "bg-ink text-surface ring-ink"
          }`}
        >
          <Icon name={entry.tone === "error" ? "alert" : "check"} className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 leading-snug">{entry.message}</span>
          <button
            type="button"
            onClick={() => dismiss(entry.id)}
            aria-label="Đóng thông báo"
            className="-mr-1 shrink-0 rounded-full p-0.5 opacity-60 hover:opacity-100"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
