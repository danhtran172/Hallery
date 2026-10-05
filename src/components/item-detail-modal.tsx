"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * The Card Detail as a popup over the Gallery. Closing goes back in history, which returns
 * to the Gallery exactly as it was — scroll, filters and all — since it never left.
 */
export function ItemDetailModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape inside a field cancels the field, not the whole popup.
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);

    // The page behind stays put while the popup scrolls on its own.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        aria-label="Chi tiết item"
        aria-modal="true"
        className="relative my-auto max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl outline-none sm:max-h-[calc(100vh-4rem)] sm:p-8"
        role="dialog"
      >
        <button
          aria-label="Đóng"
          title="Đóng (Esc)"
          className="btn btn-ghost btn-icon absolute top-3 right-3 z-10 text-lg"
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
