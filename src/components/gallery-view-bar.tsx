"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createGalleryView,
  deleteGalleryView,
  duplicateGalleryView,
  renameGalleryView,
} from "@/app/galleries/[galleryId]/view-actions";

export type GalleryViewTab = { id: string; name: string };

/** Tabs and the deliberately small set of actions that change the saved view itself. */
export function GalleryViewBar({
  galleryId,
  views,
  activeViewId,
}: {
  galleryId: string;
  views: GalleryViewTab[];
  activeViewId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function go(viewId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", viewId);
    next.delete("cardPage");
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function run(change: () => Promise<{ error: string | null; viewId?: string }>) {
    setError(null);
    setMenuOpen(false);
    startTransition(async () => {
      const result = await change();
      if (result.error) setError(result.error);
      else if (result.viewId) go(result.viewId);
      else router.refresh();
    });
  }

  const current = views.find((view) => view.id === activeViewId);

  function rename() {
    const name = window.prompt("Tên view", current?.name ?? "");
    if (name === null) return;
    run(() => renameGalleryView(galleryId, activeViewId, name));
  }

  function remove() {
    if (!window.confirm(`Xoá view “${current?.name ?? ""}”? Bộ lọc, sắp xếp và bố cục card riêng của view này sẽ mất.`)) {
      return;
    }
    run(() => deleteGalleryView(galleryId, activeViewId));
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line pb-2">
      <div role="tablist" aria-label="View" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={view.id === activeViewId}
            onClick={() => go(view.id)}
            className={`btn btn-sm ${view.id === activeViewId ? "bg-brand-soft text-brand-hover" : "btn-ghost"}`}
          >
            {view.name}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => createGalleryView(galleryId, activeViewId))}
          title="Tạo view mới từ view đang mở"
          className="btn btn-ghost btn-sm text-muted"
        >
          + View
        </button>
      </div>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="btn btn-ghost btn-sm"
        >
          {pending ? "Đang lưu…" : "View này ▾"}
        </button>
        {menuOpen && (
          <div role="menu" className="popover absolute right-0 z-30 mt-1 w-48 py-1">
            <MenuItem onClick={rename}>Đổi tên</MenuItem>
            <MenuItem onClick={() => run(() => duplicateGalleryView(galleryId, activeViewId))}>Nhân bản</MenuItem>
            <MenuItem onClick={remove} danger disabled={views.length <= 1}>
              Xoá view
            </MenuItem>
          </div>
        )}
      </div>
      {error && <p className="basis-full text-xs text-danger">{error}</p>}
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  disabled,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas disabled:opacity-40 ${
        danger ? "text-danger" : "text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}
