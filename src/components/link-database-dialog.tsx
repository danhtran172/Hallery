"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkDataSource, loadLinkableDataSources, type LinkableDataSource } from "@/app/database-actions";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { Icon } from "@/components/icons";
import { ModalFrame } from "@/components/modal-frame";
import { relativeTime } from "@/lib/relative-time";

/**
 * Picks another Notion database to sit beside this gallery as a tab. Its gallery is nested
 * under this one; Notion itself is not touched.
 */
export function LinkDatabaseDialog({
  gallery,
  onClose,
  onCreateNew,
}: {
  gallery: { id: string; name: string };
  onClose: () => void;
  onCreateNew: () => void;
}) {
  const router = useRouter();
  const [sources, setSources] = useState<LinkableDataSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadLinkableDataSources(gallery.id)
      .then((result) => {
        if (!live) return;
        if ("error" in result) setError(result.error);
        else setSources(result.sources);
      })
      .catch(() => live && setError("Không tải được danh sách database từ Notion. Thử lại sau."));
    return () => {
      live = false;
    };
  }, [gallery.id]);

  function link(source: LinkableDataSource) {
    setLinking(source.id);
    setError(null);
    startTransition(async () => {
      try {
        const result = await linkDataSource(gallery.id, source.id);
        if ("error" in result) {
          setError(result.error);
          setLinking(null);
          return;
        }
        onClose();
        router.push(`/galleries/${result.galleryId}`);
      } catch {
        setError("Không thêm được tab. Thử lại sau giây lát.");
        setLinking(null);
      }
    });
  }

  const needle = search.trim().toLowerCase();
  const visible = (sources ?? []).filter((source) => source.title.toLowerCase().includes(needle));

  return (
    <ModalFrame
      title="Thêm tab từ database khác"
      subtitle={
        <>
          Database được chọn thành một tab cạnh các view của <b className="font-medium text-ink-soft">{gallery.name}</b>, với cài
          đặt card riêng.
        </>
      }
      onClose={() => linking === null && onClose()}
    >
      <div className="flex flex-col gap-3">
        {sources && sources.length > 6 && (
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Tìm trong ${sources.length} database`}
              aria-label="Tìm database"
              autoFocus
              className="input pl-10"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        {!sources && !error && <p className="py-6 text-center text-sm text-faint">Đang tải database từ Notion…</p>}
        {sources && (
          <ul className="-mx-1 flex max-h-[50vh] flex-col gap-1 overflow-y-auto px-1">
            {visible.map((source) => (
              <li key={source.id} className="flex items-center gap-3 rounded-2xl px-2.5 py-2 hover:bg-subtle">
                <GalleryGlyph name={source.title} icon={source.icon} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{source.title}</p>
                  <p className="truncate text-xs text-muted">
                    {source.blocked
                      ? "Đang chứa gallery này"
                      : source.galleryName
                        ? `Đã có gallery — sẽ chuyển vào nhóm này`
                        : `Sửa ${relativeTime(new Date(source.editedAt))}`}
                  </p>
                </div>
                {source.linked ? (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Icon name="check" className="size-3.5" />
                    Đã là tab
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => link(source)}
                    disabled={linking !== null || source.blocked}
                    className="btn btn-secondary btn-sm"
                  >
                    {linking === source.id ? "Đang thêm…" : "Thêm tab"}
                  </button>
                )}
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2.5 py-4 text-sm text-muted">
                {sources.length === 0 ? "Integration chưa được chia sẻ database nào khác." : `Không có database nào khớp “${search}”.`}
              </li>
            )}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-faint">Không thấy database? Chia sẻ nó với integration trong Notion.</p>
          <button type="button" onClick={onCreateNew} disabled={linking !== null} className="btn btn-ghost btn-sm">
            <Icon name="plus" />
            Tạo database mới
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
