"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createGalleryView,
  deleteGalleryView,
  duplicateGalleryView,
  moveGalleryView,
  renameGalleryView,
} from "@/app/galleries/[galleryId]/view-actions";
import { Icon, type IconName } from "@/components/icons";
import { toast } from "@/components/toaster";
import { useDismiss } from "@/lib/use-dismiss";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  function go(viewId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", viewId);
    next.delete("cardPage");
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function run(change: () => Promise<{ error: string | null; viewId?: string }>) {
    setMenuOpen(false);
    startTransition(async () => {
      try {
        const result = await change();
        if (result.error) toast(result.error, "error");
        else if (result.viewId) go(result.viewId);
        else router.refresh();
      } catch {
        toast("Không lưu được view. Thử lại sau giây lát.", "error");
      }
    });
  }

  const index = views.findIndex((view) => view.id === activeViewId);
  const current = views[index];

  function rename(name: string) {
    setRenaming(false);
    if (!name.trim() || name.trim() === current?.name) return;
    run(() => renameGalleryView(galleryId, activeViewId, name));
  }

  function remove() {
    if (!window.confirm(`Xoá view “${current?.name ?? ""}”? Bộ lọc, sắp xếp và bố cục card riêng của view này sẽ mất.`)) {
      setMenuOpen(false);
      return;
    }
    run(() => deleteGalleryView(galleryId, activeViewId));
  }

  const items: { label: string; icon: IconName; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    {
      label: "Đổi tên",
      icon: "pencil",
      run: () => {
        setMenuOpen(false);
        setRenaming(true);
      },
    },
    { label: "Nhân bản", icon: "copy", run: () => run(() => duplicateGalleryView(galleryId, activeViewId)) },
    {
      label: "Dời sang trái",
      icon: "chevron-left",
      run: () => run(() => moveGalleryView(galleryId, activeViewId, -1)),
      disabled: index <= 0,
    },
    {
      label: "Dời sang phải",
      icon: "chevron-right",
      run: () => run(() => moveGalleryView(galleryId, activeViewId, 1)),
      disabled: index === views.length - 1,
    },
    { label: "Xoá view", icon: "trash", run: remove, disabled: views.length <= 1, danger: true },
  ];

  return (
    <div className={`flex min-w-0 items-center gap-1 ${pending ? "opacity-70" : ""}`}>
      <div role="tablist" aria-label="View" className="segmented">
        {views.map((view) =>
          renaming && view.id === activeViewId ? (
            <input
              key={view.id}
              autoFocus
              defaultValue={view.name}
              aria-label="Tên view"
              onBlur={(event) => rename(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") rename(event.currentTarget.value);
                if (event.key === "Escape") setRenaming(false);
              }}
              className="w-32 bg-surface text-ink shadow-xs outline-none"
            />
          ) : (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={view.id === activeViewId}
              onClick={() => (view.id === activeViewId ? setRenaming(true) : go(view.id))}
              title={view.id === activeViewId ? "Bấm lần nữa để đổi tên" : undefined}
            >
              {view.name}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => createGalleryView(galleryId, activeViewId))}
        aria-label="Tạo view mới"
        title="Tạo view mới từ view đang mở"
        className="btn btn-ghost btn-sm btn-icon text-muted"
      >
        <Icon name="plus" />
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Tuỳ chọn view"
          title="Tuỳ chọn view"
          onClick={() => setMenuOpen((open) => !open)}
          className="btn btn-ghost btn-sm btn-icon text-muted"
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <div role="menu" className="popover absolute top-full left-0 z-30 mt-1 w-52 p-1.5">
            <p className="truncate px-3 pt-1 pb-1.5 text-[11px] font-medium text-faint">View “{current?.name}”</p>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={item.run}
                className={`menu-item ${item.danger ? "text-danger hover:text-danger [&_svg]:text-danger" : ""}`}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
