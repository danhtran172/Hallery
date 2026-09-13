"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function ItemDetailModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div
      aria-label="Đóng chi tiết item"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <section
        aria-label="Chi tiết item"
        aria-modal="true"
        className="relative max-h-full w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl sm:p-8"
        role="dialog"
      >
        <button
          aria-label="Đóng chi tiết item"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          onClick={close}
          type="button"
        >
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
