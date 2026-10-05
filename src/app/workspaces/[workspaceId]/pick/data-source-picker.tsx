"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addGallery } from "./actions";
import { Icon } from "@/components/icons";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { relativeTime } from "@/lib/relative-time";

export type PickableDataSource = {
  id: string;
  databaseId: string;
  title: string;
  icon: string | null;
  notionUrl: string;
  /** Set when this database is already a Gallery the reader picked. */
  galleryId: string | null;
  editedAt: string;
};

export function DataSourcePicker({ workspaceId, sources }: { workspaceId: string; sources: PickableDataSource[] }) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const needle = search.trim().toLowerCase();
  const visible = sources.filter((source) => source.title.toLowerCase().includes(needle));

  function add(source: PickableDataSource) {
    setAdding(source.id);
    setError(null);
    startTransition(async () => {
      try {
        // Redirects to the new Gallery on success; only a failure comes back here.
        const result = await addGallery(workspaceId, source.id, source.databaseId, source.title);
        if (result?.error) {
          setError(result.error);
          setAdding(null);
        }
      } catch (caught) {
        // A redirect is delivered as a thrown signal; anything else is a real failure.
        if (caught && typeof caught === "object" && "digest" in caught && String(caught.digest).startsWith("NEXT_REDIRECT")) {
          throw caught;
        }
        setError("Không thêm được gallery. Thử lại sau giây lát.");
        setAdding(null);
      }
    });
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {sources.length > 6 && (
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Tìm trong ${sources.length} database`}
            aria-label="Tìm database"
            className="input pl-10"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((source) => (
          <li
            key={source.id}
            className="flex items-center gap-3.5 rounded-3xl bg-surface px-4 py-3.5 ring-1 ring-line transition-shadow hover:shadow-card"
          >
            <GalleryGlyph name={source.title} icon={source.icon} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{source.title}</p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <span>Sửa {relativeTime(new Date(source.editedAt))}</span>
                <a href={source.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-brand-ink">
                  Notion
                  <Icon name="external" className="size-3" />
                </a>
              </p>
            </div>
            {source.galleryId ? (
              <Link href={`/galleries/${source.galleryId}`} className="btn btn-secondary btn-sm">
                Mở gallery
                <Icon name="chevron-right" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => add(source)}
                disabled={adding !== null}
                className="btn btn-primary btn-sm"
              >
                {adding === source.id ? (
                  "Đang thêm…"
                ) : (
                  <>
                    <Icon name="plus" />
                    Thêm làm Gallery
                  </>
                )}
              </button>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="px-1 py-4 text-sm text-muted">Không có database nào khớp “{search}”.</li>}
      </ul>
    </div>
  );
}
