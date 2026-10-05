"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runNativeButton } from "@/app/galleries/[galleryId]/button-actions";

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
  confirm,
  compact,
}: {
  galleryId: string;
  pageId: string;
  propertyId: string;
  label: string;
  confirm?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function run(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    if (confirm && !window.confirm(`Chạy "${label}"?`)) return;
    setStatus(null);
    startTransition(async () => {
      const result = await runNativeButton(galleryId, pageId, propertyId);
      if (result.error) {
        setStatus({ ok: false, message: result.error });
        return;
      }
      setStatus({ ok: true, message: "Đã chạy" });
      router.refresh();
      window.setTimeout(() => setStatus(null), 2000);
    });
  }

  return (
    <span className="relative z-20 inline-flex max-w-full items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title={status && !status.ok ? status.message : undefined}
        className={`btn btn-secondary pointer-events-auto max-w-full ${compact ? "btn-sm" : ""} ${
          status?.ok ? "btn-active" : ""
        }`}
      >
        <span className="truncate">{pending ? "Đang chạy…" : status?.ok ? `✓ ${label}` : label}</span>
      </button>
      {status && !status.ok && !compact && <span className="text-xs text-danger">{status.message}</span>}
      {status && !status.ok && compact && (
        <span className="text-xs text-danger" aria-label={status.message}>
          ⚠
        </span>
      )}
    </span>
  );
}
