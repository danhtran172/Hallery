"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notionPageUrl } from "@/lib/notion-url";
import { refreshRelationGalleries } from "@/app/galleries/[galleryId]/view-actions";
import { restoreGallery } from "@/app/sidebar-actions";
import { Icon } from "@/components/icons";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { toast } from "@/components/toaster";
import { useDismiss } from "@/lib/use-dismiss";

export type RelationGalleryEntry = {
  /** Null when the linked table is not shared with the integration. */
  galleryId: string | null;
  databaseId: string;
  name: string;
  icon: string | null;
  /** The relation property pointing at this table — two properties can reach the same one. */
  propertyName: string;
  /** Its Gallery exists but sits in Hallery's trash. */
  trashed: boolean;
};

/**
 * Switches between galleries linked by relation. A relation category axis names a table
 * rather than a value, so picking one moves to that table's gallery instead of filtering
 * the cards in place — which is why this is a menu and not part of the CategoryBar.
 */
export function RelationGalleryMenu({ galleryId, entries }: { galleryId: string; entries: RelationGalleryEntry[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => setOpen(false));

  if (entries.length === 0) return null;
  const unshared = entries.filter((entry) => !entry.galleryId).length;
  const attention = unshared + entries.filter((entry) => entry.trashed).length;

  const recheck = () =>
    startTransition(async () => {
      try {
        const result = await refreshRelationGalleries(galleryId);
        toast(result.error ?? "Đã thêm các bảng liên kết.", result.error ? "error" : "info");
        router.refresh();
      } catch {
        toast("Không kiểm tra được lúc này. Thử lại sau.", "error");
      }
    });

  const restore = (id: string, name: string) =>
    startTransition(async () => {
      const result = await restoreGallery(id);
      if (result.error) return toast(result.error, "error");
      toast(`Đã khôi phục “${name}”.`);
      router.refresh();
    });

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-secondary"
      >
        <Icon name="link" />
        Liên kết
        <span className="rounded-full bg-surface px-1.5 text-xs text-muted tabular-nums ring-1 ring-line">{entries.length}</span>
        {attention > 0 && <span className="size-1.5 rounded-full bg-warn" aria-label="Có bảng cần xử lý" />}
      </button>

      {open && (
        <div role="menu" className="popover absolute top-full right-0 z-40 mt-2 w-80 p-1.5 max-sm:right-auto max-sm:left-0">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-faint">Bảng được relation trỏ tới</p>
          {entries.map((entry) =>
            entry.galleryId && entry.trashed ? (
              <div key={`${entry.propertyName}:${entry.galleryId}`} className="menu-item cursor-default hover:bg-transparent">
                <GalleryGlyph name={entry.name} icon={entry.icon} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-soft line-through decoration-faint">{entry.name}</span>
                  <span className="block text-[11px] text-faint">Đang ở thùng rác</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => restore(entry.galleryId!, entry.name)}
                  className="btn btn-secondary btn-sm"
                >
                  Khôi phục
                </button>
              </div>
            ) : entry.galleryId ? (
              <Link
                key={`${entry.propertyName}:${entry.galleryId}`}
                role="menuitem"
                href={`/galleries/${entry.galleryId}`}
                onClick={() => setOpen(false)}
                className="menu-item"
              >
                <GalleryGlyph name={entry.name} icon={entry.icon} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{entry.name}</span>
                  <span className="block truncate text-[11px] text-faint">qua {entry.propertyName}</span>
                </span>
                <Icon name="chevron-right" />
              </Link>
            ) : (
              <a
                key={`${entry.propertyName}:${entry.databaseId}`}
                role="menuitem"
                href={notionPageUrl(entry.databaseId)}
                target="_blank"
                rel="noreferrer"
                className="menu-item items-start"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn">
                  <Icon name="alert" className="size-4 !text-warn" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-ink-soft">
                    <span className="truncate">{entry.propertyName}</span>
                    <span className="shrink-0 text-[11px] text-warn">chưa chia sẻ</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                    Mở bảng trong Notion → ••• → Connections → thêm integration, rồi bấm “Kiểm tra lại”.
                  </span>
                </span>
                <Icon name="external" />
              </a>
            ),
          )}
          {unshared > 0 && (
            <div className="mt-1 border-t border-line px-1.5 pt-2 pb-1">
              <button type="button" disabled={pending} onClick={recheck} className="btn btn-secondary btn-sm w-full">
                <Icon name="refresh" className={pending ? "animate-spin" : ""} />
                {pending ? "Đang kiểm tra…" : "Kiểm tra lại"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
