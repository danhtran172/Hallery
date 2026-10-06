"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

/**
 * A centred dialog over a scrim. Escape and a press on the scrim both ask `onClose`, which
 * may decline (unsaved input) by simply not closing.
 */
export function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[65] flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-2 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) latest.current();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full ${width} animate-rise-in rounded-[1.75rem] bg-surface p-5 shadow-pop ring-1 ring-line sm:p-6`}
      >
        <div className="mb-4 flex items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Đóng" onClick={() => latest.current()} className="btn btn-ghost btn-sm btn-icon ml-auto">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
