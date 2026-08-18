"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type RelationGalleryEntry = {
  galleryId: string;
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
export function RelationGalleryMenu({ entries }: { entries: RelationGalleryEntry[] }) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-md border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-emerald-600"
      >
        Bảng liên kết ({entries.length})
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-stone-200 bg-white py-1 shadow-lg"
        >
          {entries.map((entry) => (
            <Link
              key={`${entry.propertyName}:${entry.galleryId}`}
              role="menuitem"
              href={`/galleries/${entry.galleryId}`}
              onClick={() => setOpen(false)}
              className="flex items-baseline gap-2 px-3 py-2 hover:bg-stone-50"
            >
              <span className="text-sm text-stone-800">
                {entry.icon && !entry.icon.startsWith("http") ? `${entry.icon} ` : ""}
                {entry.name}
              </span>
              <span className="ml-auto shrink-0 text-xs text-stone-400">{entry.propertyName}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
