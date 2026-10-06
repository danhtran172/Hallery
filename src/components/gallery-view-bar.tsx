"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createGalleryView,
  deleteGalleryView,
  duplicateGalleryView,
  moveGalleryView,
  renameGalleryView,
} from "@/app/galleries/[galleryId]/view-actions";
import { CreateDatabaseDialog } from "@/components/create-database-dialog";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { Icon, type IconName } from "@/components/icons";
import { LinkDatabaseDialog } from "@/components/link-database-dialog";
import { toast } from "@/components/toaster";
import { useDismiss } from "@/lib/use-dismiss";
import type { ViewType } from "@/lib/table-layout";

export type GalleryViewTab = { id: string; name: string; type: ViewType };

/** Another gallery in the same group — its parent, a sibling or a child — shown as a tab. */
export type LinkedGalleryTab = { id: string; name: string; icon: string | null };

/**
 * Tabs and the deliberately small set of actions that change the saved view itself.
 *
 * Galleries nested together read as one set of tabs: the ones placed before this gallery
 * (its parent, earlier siblings) sit left of its views, the rest to the right. Those tabs
 * open their own gallery; only this gallery's views switch in place.
 */
export function GalleryViewBar({
  workspaceId,
  galleryId,
  galleryName,
  views,
  activeViewId,
  linkedBefore = [],
  linkedAfter = [],
}: {
  workspaceId: string;
  galleryId: string;
  galleryName: string;
  views: GalleryViewTab[];
  activeViewId: string;
  linkedBefore?: LinkedGalleryTab[];
  linkedAfter?: LinkedGalleryTab[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [dialog, setDialog] = useState<"link" | "create" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));
  useDismiss(addRef, addOpen, () => setAddOpen(false));

  function go(viewId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", viewId);
    next.delete("cardPage");
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  function run(change: () => Promise<{ error: string | null; viewId?: string }>) {
    setMenuOpen(false);
    setAddOpen(false);
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

  const addItems: { label: string; hint: string; icon: IconName; run: () => void }[] = [
    {
      label: "Dạng xem mới",
      hint: "Lọc, sắp xếp, bố cục khác trên database này",
      icon: "layers",
      run: () => run(() => createGalleryView(galleryId, activeViewId)),
    },
    {
      label: "Từ database khác…",
      hint: "Một database đã có trong Notion, thành tab bên cạnh",
      icon: "link",
      run: () => {
        setAddOpen(false);
        setDialog("link");
      },
    },
    {
      label: "Database mới…",
      hint: "Tạo database trong Notion rồi thêm làm tab",
      icon: "database",
      run: () => {
        setAddOpen(false);
        setDialog("create");
      },
    },
  ];

  function linkedTab(tab: LinkedGalleryTab) {
    return (
      <Link key={tab.id} href={`/galleries/${tab.id}`} role="tab" aria-selected={false} title={`Mở gallery “${tab.name}”`}>
        <GalleryGlyph name={tab.name} icon={tab.icon} size="xs" />
        {tab.name}
      </Link>
    );
  }

  return (
    <div className={`flex min-w-0 items-center gap-1 ${pending ? "opacity-70" : ""}`}>
      {dialog === "link" && (
        <LinkDatabaseDialog
          gallery={{ id: galleryId, name: galleryName }}
          onClose={() => setDialog(null)}
          onCreateNew={() => setDialog("create")}
        />
      )}
      {dialog === "create" && (
        <CreateDatabaseDialog
          workspaceId={workspaceId}
          parentGallery={{ id: galleryId, name: galleryName }}
          onClose={() => setDialog(null)}
        />
      )}
      <div role="tablist" aria-label="View" className="segmented">
        {linkedBefore.map(linkedTab)}
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
              {view.type === "table" && <Icon name="table" className="size-3.5" label="Bảng" />}
              {view.name}
            </button>
          ),
        )}
        {linkedAfter.map(linkedTab)}
      </div>

      <div ref={addRef} className="relative">
        <button
          type="button"
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          aria-label="Tạo view mới"
          title="Tạo view mới"
          onClick={() => setAddOpen((open) => !open)}
          className="btn btn-ghost btn-sm btn-icon text-muted"
        >
          <Icon name="plus" />
        </button>
        {addOpen && (
          <div role="menu" className="popover absolute top-full left-0 z-30 mt-1 w-72 p-1.5">
            {addItems.map((item) => (
              <button key={item.label} type="button" role="menuitem" onClick={item.run} className="menu-item items-start">
                <Icon name={item.icon} />
                <span className="min-w-0">
                  <span className="block text-ink">{item.label}</span>
                  <span className="block text-xs text-muted">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

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
