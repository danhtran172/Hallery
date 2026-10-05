"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notionPageUrl } from "@/lib/notion-url";
import { refreshRelationGalleries } from "@/app/galleries/[galleryId]/view-actions";

export type RelationGalleryEntry = {
  /** Null when the linked table is not shared with the integration. */
  galleryId: string | null;
  databaseId: string;
  name: string;
  icon: string | null;
  /** The relation property pointing at this table — two properties can reach the same one. */
  propertyName: string;
};

/**
 * Switches between galleries linked by relation. A relation category axis names a table
 * rather than a value, so picking one moves to that table's gallery instead of filtering
 * the cards in place — which is why this is a menu and not part of the CategoryBar.
 */
export function RelationGalleryMenu({ galleryId, entries }: { galleryId: string; entries: RelationGalleryEntry[] }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (entries.length === 0) return null;
  const unshared = entries.filter((entry) => !entry.galleryId).length;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-secondary"
      >
        Bảng liên kết ({entries.length})
        {unshared > 0 && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Có bảng chưa chia sẻ" />}
      </button>

      {open && (
        <div role="menu" className="popover absolute right-0 z-30 mt-1 w-72 py-1">
          {entries.map((entry) =>
            entry.galleryId ? (
              <Link
                key={`${entry.propertyName}:${entry.galleryId}`}
                role="menuitem"
                href={`/galleries/${entry.galleryId}`}
                onClick={() => setOpen(false)}
                className="flex items-baseline gap-2 px-3 py-2 hover:bg-canvas"
              >
                <span className="min-w-0 truncate text-sm text-ink">
                  {entry.icon && !entry.icon.startsWith("http") ? `${entry.icon} ` : ""}
                  {entry.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-faint">{entry.propertyName}</span>
              </Link>
            ) : (
              <a
                key={`${entry.propertyName}:${entry.databaseId}`}
                role="menuitem"
                href={notionPageUrl(entry.databaseId)}
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-2 hover:bg-canvas"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm text-ink-soft">{entry.propertyName}</span>
                  <span className="ml-auto shrink-0 text-xs text-amber-700">Chưa chia sẻ ↗</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                  Mở bảng này trong Notion → ••• → Connections → thêm integration, rồi bấm “Kiểm tra lại”.
                </span>
              </a>
            ),
          )}
          {unshared > 0 && (
            <div className="mt-1 flex items-center gap-2 border-t border-line px-3 pt-2 pb-1">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await refreshRelationGalleries(galleryId);
                    setMessage(result.error ?? "Đã thêm các bảng liên kết.");
                    router.refresh();
                  })
                }
                className="btn btn-secondary btn-sm"
              >
                {pending ? "Đang kiểm tra…" : "Kiểm tra lại"}
              </button>
              {message && <span className="text-[11px] text-muted">{message}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
