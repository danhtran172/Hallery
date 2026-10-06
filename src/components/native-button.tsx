"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { runNativeButton, type ButtonFormTarget } from "@/app/galleries/[galleryId]/button-actions";
import { ButtonFormDialog } from "@/components/button-form-dialog";
import { itemHref } from "@/lib/property-render";
import { BUTTON_COLOR_CLASSES, type ButtonColor, type ButtonConfirm } from "@/lib/native-button";

/**
 * A Notion button property brought back to life: pressing it runs the value writes
 * configured in Hallery. Sits above a card's whole-card link, so pressing it never opens
 * the item underneath.
 */
export function NativeButton({
  galleryId,
  pageId,
  propertyId,
  label,
  icon,
  color,
  confirm,
  compact,
}: {
  galleryId: string;
  pageId: string;
  propertyId: string;
  label: string;
  icon?: string;
  color?: ButtonColor;
  confirm?: ButtonConfirm;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState<ButtonFormTarget | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function run() {
    setAsking(false);
    setStatus(null);
    startTransition(async () => {
      const result = await runNativeButton(galleryId, pageId, propertyId);
      if (result.error) {
        setStatus({ ok: false, message: result.error });
        router.refresh();
        return;
      }
      if (result.view) {
        // Inside the gallery this lands in the item popup, like opening the card itself.
        router.push(itemHref(result.view.galleryId, result.view.pageId), { scroll: false });
        return;
      }
      router.refresh();
      if (result.open) {
        setForm(result.open);
        return;
      }
      setStatus({ ok: true, message: "Đã chạy" });
      window.setTimeout(() => setStatus(null), 2000);
    });
  }

  function press(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    if (confirm) setAsking(true);
    else run();
  }

  return (
    <span className="relative z-20 inline-flex max-w-full items-center gap-1.5">
      <ButtonFace
        label={pending ? "Đang chạy…" : status?.ok ? `✓ ${label}` : label}
        icon={pending || status?.ok ? undefined : icon}
        color={color}
        compact={compact}
        onClick={press}
        disabled={pending}
        title={status && !status.ok ? status.message : undefined}
      />
      {status && !status.ok && !compact && <span className="text-xs text-danger">{status.message}</span>}
      {status && !status.ok && compact && (
        <span className="text-xs text-danger" aria-label={status.message}>
          ⚠
        </span>
      )}
      {asking && confirm && (
        <ConfirmDialog label={label} confirm={confirm} onCancel={() => setAsking(false)} onConfirm={run} />
      )}
      {form && <ButtonFormDialog target={form} onClose={() => setForm(null)} />}
    </span>
  );
}

/** How a button looks, shared by the live button and the settings preview. */
export function ButtonFace({
  label,
  icon,
  color,
  compact,
  onClick,
  disabled,
  title,
}: {
  label: string;
  icon?: string;
  color?: ButtonColor;
  compact?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`btn pointer-events-auto max-w-full ${BUTTON_COLOR_CLASSES[color ?? "default"]} ${
        compact ? "btn-sm" : ""
      }`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Notion's "Show confirmation" step, in Hallery's face. Rendered on <body> so no card's
 * clipping or stacking hides it; React events still bubble to the card, hence the stops.
 */
export function ConfirmDialog({
  label,
  confirm,
  onCancel,
  onConfirm,
}: {
  label: string;
  confirm: ButtonConfirm;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onCancel, onConfirm });
  useEffect(() => {
    latest.current = { onCancel, onConfirm };
  });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    // Capture on window runs before the item popup's own Escape handler, so Escape closes
    // only this question, not the popup underneath it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      latest.current.onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  const title = confirm.title || `Chạy “${label}”?`;
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-scrim p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onCancel();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="native-button-confirm-title"
        aria-describedby={confirm.message ? "native-button-confirm-message" : undefined}
        className="w-full max-w-sm animate-rise-in rounded-3xl bg-surface p-5 shadow-pop ring-1 ring-line"
      >
        <h2 id="native-button-confirm-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        {confirm.message && (
          <p id="native-button-confirm-message" className="mt-2 text-sm whitespace-pre-line text-ink-soft">
            {confirm.message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
            {confirm.cancelLabel || "Huỷ"}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className="btn btn-primary btn-sm">
            {confirm.confirmLabel || "Chạy"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
