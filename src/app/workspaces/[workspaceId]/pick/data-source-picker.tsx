"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addGallery } from "./actions";

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
      // Redirects to the new Gallery on success; only a failure comes back here.
      const result = await addGallery(workspaceId, source.id, source.databaseId, source.title);
      if (result?.error) {
        setError(result.error);
        setAdding(null);
      }
    });
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {sources.length > 6 && (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Tìm trong ${sources.length} database`}
          aria-label="Tìm database"
          className="input"
        />
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((source) => (
          <li key={source.id} className="panel flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="w-6 shrink-0 text-center text-lg">
              {source.icon ?? "🗂️"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{source.title}</p>
              <a href={source.notionUrl} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-brand">
                Mở trong Notion ↗
              </a>
            </div>
            {source.galleryId ? (
              <Link href={`/galleries/${source.galleryId}`} className="btn btn-secondary btn-sm">
                Mở gallery →
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => add(source)}
                disabled={adding !== null}
                className="btn btn-primary btn-sm"
              >
                {adding === source.id ? "Đang thêm…" : "Thêm làm Gallery"}
              </button>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="px-1 py-4 text-sm text-muted">Không có database nào khớp “{search}”.</li>}
      </ul>
    </div>
  );
}
