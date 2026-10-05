"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { buildGalleryTree, type GalleryNode, type GalleryTreeNode } from "@/lib/gallery-tree";
import {
  deleteGalleryForever,
  emptyTrash,
  nestGallery,
  renameGallery,
  reorderGallery,
  restoreGallery,
  trashGallery,
  type SidebarActionResult,
} from "@/app/sidebar-actions";
import { LinkSpinner } from "@/components/link-pending";
import { Icon, LogoMark, Wordmark } from "@/components/icons";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { AppearanceControl } from "@/components/appearance-control";
import { openSearch } from "@/components/command-palette";
import { toast } from "@/components/toaster";
import { useDismiss } from "@/lib/use-dismiss";

/** How long a drag must rest on a gallery before the drop means "put it inside". */
const NEST_HOLD_MS = 1500;

const COLLAPSED_KEY = "hallery.sidebar.collapsed";

/**
 * The collapsed flag lives in localStorage, which React has to be told about rather than
 * discover. Reading it through a store keeps it out of an effect: the server renders
 * expanded, and the first client render already knows better, with no flash and no
 * setState during mount.
 */
let collapseListeners: (() => void)[] = [];
const collapseStore = {
  subscribe(callback: () => void) {
    collapseListeners.push(callback);
    return () => {
      collapseListeners = collapseListeners.filter((entry) => entry !== callback);
    };
  },
  get: () => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  },
  getServer: () => false,
  set(value: boolean) {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      // Storage refused (private window): the toggle still works for this page.
    }
    collapseListeners.forEach((callback) => callback());
  },
};

export type TrashedGallery = { id: string; name: string };
export type SidebarWorkspace = { id: string; name: string };

/** Shows a failed action's sentence; successes speak for themselves by changing the list. */
function report(result: SidebarActionResult) {
  if (result.error) toast(result.error, "error");
  return !result.error;
}

/**
 * The workspace's galleries, always on screen.
 *
 * A sub-gallery is just a gallery with a parent, so the tree here is the grouping — there
 * is no separate folder to keep in sync. Dragging within a level reorders; resting on a
 * gallery for a moment switches the drop to nesting, which is the only way to tell the two
 * intentions apart with one gesture.
 */
export function GallerySidebar({
  galleries,
  trashed,
  workspaces,
}: {
  galleries: GalleryNode[];
  trashed: TrashedGallery[];
  workspaces: SidebarWorkspace[];
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(collapseStore.subscribe, collapseStore.get, collapseStore.getServer);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleCollapsed = () => collapseStore.set(!collapsed);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const clearHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  function handleDragOver({ over, active }: DragOverEvent) {
    const overId = over ? String(over.id) : null;
    const activeId = String(active.id);
    clearHold();

    if (!overId || overId === activeId) {
      setNestTarget(null);
      return;
    }
    // Resting is the signal. Until the timer fires the drop still means "reorder".
    setNestTarget(null);
    holdRef.current = setTimeout(() => setNestTarget(overId), NEST_HOLD_MS);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    clearHold();
    const target = nestTarget;
    setNestTarget(null);
    if (!over) return;

    const dragId = String(active.id);
    const overId = String(over.id);
    if (dragId === overId) return;

    if (overId === "root") report(await nestGallery(dragId, null));
    else if (target === overId) report(await nestGallery(dragId, overId));
    else report(await reorderGallery(dragId, overId));
  }

  const tree = buildGalleryTree(galleries);

  /** The full list, shared by the desktop sidebar and the phone drawer. */
  const content = (headerAction: React.ReactNode) => (
    <>
      <div className="flex h-9 items-center justify-between pl-2">
        <Link href="/" aria-label="Hallery — trang chủ" className="rounded-lg">
          <Wordmark />
        </Link>
        {headerAction}
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="flex h-9 w-full items-center gap-2 rounded-xl bg-surface/70 px-3 text-[13px] text-muted ring-1 ring-line transition-colors hover:bg-surface hover:text-ink-soft"
      >
        <Icon name="search" className="size-4" />
        <span className="flex-1 text-left">Tìm kiếm</span>
        <kbd className="kbd">Ctrl K</kbd>
      </button>

      <nav className="flex flex-col gap-0.5">
        <NavLink href="/" active={pathname === "/"} icon="home">
          Trang chủ
        </NavLink>
      </nav>

      <div className="mt-1 flex items-center justify-between pr-1 pl-2">
        <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">Gallery</span>
        <AddGalleryButton workspaces={workspaces} />
      </div>

      {/* The id must be given, not generated: dnd-kit numbers contexts from a counter that
          starts fresh on the server and is already advanced on the client, so the
          aria-describedby it writes would differ and break hydration for the whole tree —
          this context lives in the root layout, so that means every page. */}
      <DndContext
        id="gallery-sidebar"
        sensors={sensors}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={clearHold}
      >
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
          {tree.length === 0 && <p className="px-2 py-2 text-xs text-faint">Chưa có gallery nào.</p>}
          {tree.map((node) => (
            <SidebarNode key={node.id} node={node} depth={0} pathname={pathname} nestTarget={nestTarget} />
          ))}
          <RootDropZone active={tree.length > 0} />
        </div>
      </DndContext>

      <div className="flex flex-col gap-0.5 border-t border-line pt-2">
        <TrashSection trashed={trashed} />
        <Link href="/connect" className="btn btn-ghost btn-sm w-full justify-start">
          <Icon name="plug" />
          Kết nối Notion
        </Link>
        <AppearanceControl />
      </div>
    </>
  );

  // Phones get a slim bar and a drawer: a 15rem sidebar left a 375px screen with room for
  // half a card.
  const mobile = (
    <>
      <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-line bg-canvas/85 px-3 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Mở danh sách gallery"
          aria-expanded={mobileOpen}
          className="btn btn-ghost btn-icon"
        >
          <Icon name="menu" className="size-5" />
        </button>
        <Link href="/" aria-label="Hallery — trang chủ" className="ml-1">
          <Wordmark />
        </Link>
        <button type="button" onClick={openSearch} aria-label="Tìm kiếm" className="btn btn-ghost btn-icon ml-auto">
          <Icon name="search" className="size-5" />
        </button>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Danh sách gallery">
          <div className="absolute inset-0 animate-fade-in bg-scrim" onClick={() => setMobileOpen(false)} />
          <aside
            className="absolute inset-y-2 left-2 flex w-72 max-w-[85vw] animate-rise-in flex-col gap-2 rounded-3xl bg-canvas p-3 shadow-pop"
            // Following any link inside means the reader is done with the drawer.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setMobileOpen(false);
            }}
          >
            {content(
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Đóng" className="btn btn-ghost btn-sm btn-icon">
                <Icon name="x" />
              </button>,
            )}
          </aside>
        </div>
      )}
    </>
  );

  if (!collapsed) {
    return (
      <>
        {mobile}
        <aside className="sticky top-2 hidden h-[calc(100dvh-1rem)] w-64 shrink-0 flex-col gap-2 px-3 py-1 md:flex">
          {content(
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Thu gọn thanh bên"
              title="Thu gọn thanh bên"
              className="btn btn-ghost btn-sm btn-icon text-muted"
            >
              <Icon name="panel-left" />
            </button>,
          )}
        </aside>
      </>
    );
  }

  return (
    <>
      {mobile}
      <aside className="sticky top-2 hidden h-[calc(100dvh-1rem)] w-16 shrink-0 flex-col items-center gap-1.5 py-1 md:flex">
        <Link href="/" aria-label="Hallery — trang chủ" className="flex size-9 items-center justify-center text-ink">
          <LogoMark className="size-6" />
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Mở rộng thanh bên"
          title="Mở rộng thanh bên"
          className="btn btn-ghost btn-sm btn-icon text-muted"
        >
          <Icon name="panel-left" />
        </button>
        <button type="button" onClick={openSearch} aria-label="Tìm kiếm" title="Tìm kiếm (Ctrl K)" className="btn btn-ghost btn-sm btn-icon">
          <Icon name="search" />
        </button>
        <div className="my-1 h-px w-6 bg-line" />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
          {galleries
            .filter((gallery) => !gallery.parentGalleryId)
            .map((gallery) => {
              const active = pathname.startsWith(`/galleries/${gallery.id}`);
              return (
                <Link
                  key={gallery.id}
                  href={`/galleries/${gallery.id}`}
                  title={gallery.name}
                  aria-label={gallery.name}
                  aria-current={active ? "page" : undefined}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    active ? "bg-surface shadow-xs ring-1 ring-line" : "hover:bg-surface/60"
                  }`}
                >
                  <GalleryGlyph name={gallery.name} icon={gallery.icon} size="md" />
                </Link>
              );
            })}
        </div>
        <AddGalleryButton workspaces={workspaces} />
        <AppearanceControl compact />
      </aside>
    </>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: "home";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-xl px-2.5 text-[13px] transition-colors ${
        active ? "bg-surface font-medium text-ink shadow-xs ring-1 ring-line" : "text-ink-soft hover:bg-surface/60 hover:text-ink"
      }`}
    >
      <Icon name={icon} className="size-4 text-muted" />
      {children}
    </Link>
  );
}

/**
 * "+ gallery" goes straight to picking a database. With several workspaces it first asks
 * which one, rather than dropping the reader on the dashboard to find the button again.
 */
function AddGalleryButton({ workspaces }: { workspaces: SidebarWorkspace[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (workspaces.length <= 1) {
    return (
      <Link
        href={workspaces[0] ? `/workspaces/${workspaces[0].id}/pick` : "/connect"}
        aria-label="Thêm gallery"
        title="Thêm gallery"
        className="btn btn-ghost btn-sm btn-icon size-7 text-muted"
      >
        <Icon name="plus" />
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Thêm gallery"
        title="Thêm gallery"
        className="btn btn-ghost btn-sm btn-icon size-7 text-muted"
      >
        <Icon name="plus" />
      </button>
      {open && (
        <div role="menu" className="popover absolute top-full left-0 z-40 mt-1 w-60 p-1.5 md:right-0 md:left-auto">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-faint">Thêm gallery từ workspace</p>
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              role="menuitem"
              href={`/workspaces/${workspace.id}/pick`}
              onClick={() => setOpen(false)}
              className="menu-item"
            >
              <Icon name="database" />
              <span className="min-w-0 truncate">{workspace.name}</span>
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href="/connect" onClick={() => setOpen(false)} className="menu-item">
            <Icon name="plug" />
            Kết nối workspace mới
          </Link>
        </div>
      )}
    </div>
  );
}

function SidebarNode({
  node,
  depth,
  pathname,
  nestTarget,
}: {
  node: GalleryTreeNode;
  depth: number;
  pathname: string;
  nestTarget: string | null;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: node.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });
  const [renaming, setRenaming] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = pathname.startsWith(`/galleries/${node.id}`);
  const willNest = nestTarget === node.id;

  function rename(name: string) {
    setRenaming(false);
    if (!name.trim() || name.trim() === node.name) return;
    startTransition(async () => {
      if (report(await renameGallery(node.id, name))) router.refresh();
    });
  }

  function trash() {
    if (!window.confirm(`Bỏ “${node.name}” vào thùng rác? Có thể khôi phục lại; Notion không bị đụng tới.`)) return;
    startTransition(async () => {
      if (!report(await trashGallery(node.id))) return;
      toast(`Đã bỏ “${node.name}” vào thùng rác.`);
      // Staying on a gallery that just left the list reads as if nothing happened.
      if (active) router.push("/");
    });
  }

  return (
    <div>
      <div
        ref={dropRef}
        style={{ paddingLeft: depth * 14 }}
        className={`group relative flex items-center rounded-xl ${
          willNest ? "bg-brand-soft ring-1 ring-brand" : isOver ? "bg-surface/70" : ""
        } ${isDragging || pending ? "opacity-50" : ""}`}
      >
        {/* On hover the gallery's tile turns into its drag handle — no extra column for a
            control that is used once in a while. Touch screens skip it: dragging inside a
            scrolling drawer fights the scroll. */}
        {!renaming && (<button
          ref={dragRef}
          {...listeners}
          {...attributes}
          type="button"
          aria-label={`Di chuyển ${node.name}`}
          title="Kéo để sắp xếp · giữ yên trên gallery khác để lồng vào"
          className="absolute top-1/2 z-10 flex size-6 -translate-y-1/2 cursor-grab items-center justify-center rounded-md bg-surface text-muted opacity-0 shadow-xs ring-1 ring-line transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [@media(hover:none)]:hidden"
          style={{ left: depth * 14 + 6 }}
        >
          <Icon name="grip" className="size-3.5" />
        </button>)}
        {renaming ? (
          <input
            autoFocus
            defaultValue={node.name}
            aria-label="Tên gallery"
            onBlur={(event) => rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename(event.currentTarget.value);
              if (event.key === "Escape") setRenaming(false);
            }}
            className="input input-sm h-8 flex-1"
          />
        ) : (
          <Link
            href={`/galleries/${node.id}`}
            aria-current={active ? "page" : undefined}
            className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl pr-8 pl-2 text-[13px] transition-colors ${
              active
                ? "bg-surface font-medium text-ink shadow-xs ring-1 ring-line"
                : "text-ink-soft hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <GalleryGlyph name={node.name} icon={node.icon} />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {node.autoAdded && (
              <span title="Tự thêm qua relation" className="shrink-0 text-faint">
                <Icon name="link" className="size-3" />
              </span>
            )}
            <LinkSpinner />
          </Link>
        )}
        {!renaming && (
          <RowMenu
            label={node.name}
            items={[
              { label: "Đổi tên", icon: "pencil", run: () => setRenaming(true) },
              { label: "Bỏ vào thùng rác", icon: "trash", run: trash, danger: true },
            ]}
          />
        )}
      </div>

      {node.children.map((child) => (
        <SidebarNode key={child.id} node={child} depth={depth + 1} pathname={pathname} nestTarget={nestTarget} />
      ))}
    </div>
  );
}

type RowMenuItem = { label: string; icon: "pencil" | "trash" | "restore"; run: () => void; danger?: boolean };

/**
 * A row's "⋯" menu. Positioned against the window rather than the row, because the list
 * scrolls and would otherwise clip it.
 */
function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, at !== null, () => setAt(null));

  return (
    <span ref={ref} className="absolute right-1">
      <button
        type="button"
        aria-label={`Tuỳ chọn cho ${label}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(event) => {
          if (at) return setAt(null);
          const rect = event.currentTarget.getBoundingClientRect();
          setAt({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 200) });
        }}
        className={`flex size-6 items-center justify-center rounded-lg text-muted transition-opacity hover:bg-subtle hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${
          at ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <Icon name="more" className="size-4" />
      </button>
      {at && (
        <span role="menu" className="popover fixed z-50 flex w-48 flex-col p-1.5" style={{ top: at.top, left: at.left }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null);
                item.run();
              }}
              className={`menu-item ${item.danger ? "text-danger hover:text-danger [&_svg]:text-danger" : ""}`}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * The trash: restore, delete one for good, or empty it. Deleting only ever removes
 * Hallery's own settings for a gallery — the Notion database is never touched.
 */
function TrashSection({ trashed }: { trashed: TrashedGallery[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (change: () => Promise<SidebarActionResult>, done?: string) =>
    startTransition(async () => {
      if (!report(await change())) return;
      if (done) toast(done);
      router.refresh();
    });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="btn btn-ghost btn-sm w-full justify-start"
      >
        <Icon name="trash" />
        Thùng rác
        {trashed.length > 0 && <span className="ml-auto text-xs text-faint tabular-nums">{trashed.length}</span>}
      </button>
      {open && (
        <div className="mx-1 mt-1 mb-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-2xl bg-surface/60 p-1.5 ring-1 ring-line">
          {trashed.length === 0 && <p className="px-2 py-2 text-xs text-faint">Thùng rác trống.</p>}
          {trashed.map((gallery) => (
            <div key={gallery.id} className="group flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface">
              <span className="min-w-0 flex-1 truncate">{gallery.name}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => restoreGallery(gallery.id), `Đã khôi phục “${gallery.name}”.`)}
                title="Khôi phục"
                aria-label={`Khôi phục ${gallery.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-brand-ink hover:bg-brand-soft"
              >
                <Icon name="restore" className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Xoá hẳn “${gallery.name}” khỏi Hallery? Cấu hình hiển thị, bố cục và view của nó sẽ mất vĩnh viễn. Database trong Notion không bị đụng tới.`,
                    )
                  ) {
                    run(() => deleteGalleryForever(gallery.id), `Đã xoá hẳn “${gallery.name}” khỏi Hallery.`);
                  }
                }}
                title="Xoá hẳn khỏi Hallery"
                aria-label={`Xoá hẳn ${gallery.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-danger-soft hover:text-danger"
              >
                <Icon name="x" className="size-3.5" />
              </button>
            </div>
          ))}
          {trashed.length > 1 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Xoá hẳn ${trashed.length} gallery trong thùng rác khỏi Hallery? Không hoàn tác được. Notion không bị đụng tới.`,
                  )
                ) {
                  run(emptyTrash, "Đã dọn sạch thùng rác.");
                }
              }}
              className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs text-danger hover:bg-danger-soft"
            >
              Dọn sạch thùng rác
            </button>
          )}
          <p className="px-2 pt-1 pb-0.5 text-[10px] leading-snug text-faint">
            Chỉ Hallery ngừng quản lý — database trong Notion không hề bị đụng tới.
          </p>
        </div>
      )}
    </div>
  );
}

/** Somewhere to drop a sub-gallery so it climbs back out to the top level. */
function RootDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "root" });
  // Only meaningful mid-drag; at rest it was a permanent line of instructions.
  const { active: dragging } = useDndContext();
  if (!active) return null;

  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded-xl border border-dashed px-2 py-2 text-center text-[11px] transition-opacity ${
        dragging ? "opacity-100" : "pointer-events-none opacity-0"
      } ${isOver ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong text-faint"}`}
    >
      Thả vào đây để đưa ra ngoài cùng
    </div>
  );
}
