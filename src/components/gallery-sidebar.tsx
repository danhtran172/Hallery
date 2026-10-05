"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
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
import { buildGalleryTree, filterTree, type GalleryNode, type GalleryTreeNode } from "@/lib/gallery-tree";
import { nestGallery, reorderGallery, restoreGallery, trashGallery } from "@/app/sidebar-actions";
import { LinkSpinner } from "@/components/link-pending";

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
  get: () => window.localStorage.getItem(COLLAPSED_KEY) === "1",
  getServer: () => false,
  set(value: boolean) {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    collapseListeners.forEach((callback) => callback());
  },
};

export type TrashedGallery = { id: string; name: string };

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
}: {
  galleries: GalleryNode[];
  trashed: TrashedGallery[];
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.get,
    collapseStore.getServer,
  );
  const [search, setSearch] = useState("");
  const [showTrash, setShowTrash] = useState(false);
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

    if (overId === "root") await nestGallery(dragId, null);
    else if (target === overId) await nestGallery(dragId, overId);
    else await reorderGallery(dragId, overId);
  }

  const tree = filterTree(buildGalleryTree(galleries), search);

  /** The full list, shared by the desktop sidebar and the phone drawer. */
  const content = (headerAction: React.ReactNode) => (
    <>
      <div className="flex items-center justify-between">
        <Link href="/" className="px-1 text-sm font-semibold text-brand hover:underline">
          Hallery
        </Link>
        {headerAction}
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tìm gallery"
        aria-label="Tìm gallery"
        className="input input-sm"
      />

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
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {tree.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-faint">
              {search ? "Không có gallery nào khớp." : "Chưa có gallery nào."}
            </p>
          )}
          {tree.map((node) => (
            <SidebarNode key={node.id} node={node} depth={0} pathname={pathname} nestTarget={nestTarget} />
          ))}
          <RootDropZone active={tree.length > 0} />
        </div>
      </DndContext>

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <Link href="/" className="btn btn-ghost btn-sm justify-start">
          + Thêm gallery
        </Link>
        <Link href="/connect" className="btn btn-ghost btn-sm justify-start">
          Kết nối Notion
        </Link>
      </div>

      <div className="border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setShowTrash((v) => !v)}
          aria-expanded={showTrash}
          className="flex w-full items-center justify-between px-1 text-[11px] font-medium tracking-wide text-faint uppercase hover:text-ink-soft"
        >
          <span>Thùng rác</span>
          <span>{trashed.length}</span>
        </button>
        {showTrash && (
          <div className="mt-1 flex flex-col gap-1">
            {trashed.length === 0 && <p className="px-1 text-[11px] text-faint">Trống.</p>}
            {trashed.map((gallery) => (
              <div key={gallery.id} className="flex items-center gap-1 px-1 text-xs text-muted">
                <span className="min-w-0 flex-1 truncate line-through">{gallery.name}</span>
                <button
                  type="button"
                  onClick={() => restoreGallery(gallery.id)}
                  className="shrink-0 text-[11px] text-brand hover:underline"
                >
                  Khôi phục
                </button>
              </div>
            ))}
            <p className="px-1 pt-1 text-[10px] leading-snug text-faint">
              Bỏ vào đây chỉ là Hallery ngừng quản lý. Database trong Notion không hề bị đụng tới.
            </p>
          </div>
        )}
      </div>
    </>
  );

  // Phones get a slim bar and a drawer: a 15rem sidebar left a 375px screen with room for
  // half a card.
  const mobile = (
    <>
      <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Mở danh sách gallery"
          aria-expanded={mobileOpen}
          className="btn btn-ghost btn-sm btn-icon text-base"
        >
          ☰
        </button>
        <Link href="/" className="text-sm font-semibold text-brand">
          Hallery
        </Link>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Danh sách gallery">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setMobileOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-2 bg-canvas p-3 shadow-xl"
            // Following any link inside means the reader is done with the drawer.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setMobileOpen(false);
            }}
          >
            {content(
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Đóng"
                className="btn btn-ghost btn-sm btn-icon text-base"
              >
                ×
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
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-2 border-r border-line bg-canvas p-3 md:flex">
          {content(
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Thu gọn thanh bên"
              title="Thu gọn thanh bên"
              className="btn btn-ghost btn-sm btn-icon"
            >
              «
            </button>,
          )}
        </aside>
      </>
    );
  }

  return (
    <>
      {mobile}
      <aside className="sticky top-0 hidden h-screen w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-canvas py-3 md:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Mở rộng thanh bên"
          title="Mở rộng thanh bên"
          className="btn btn-ghost btn-sm btn-icon"
        >
          »
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
          {galleries
            .filter((gallery) => !gallery.parentGalleryId)
            .map((gallery) => (
              <Link
                key={gallery.id}
                href={`/galleries/${gallery.id}`}
                title={gallery.name}
                aria-label={gallery.name}
                className={`flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-medium ${
                  pathname.startsWith(`/galleries/${gallery.id}`)
                    ? "bg-brand text-white"
                    : "bg-surface text-ink-soft hover:bg-stone-200"
                }`}
              >
                {gallery.icon && !gallery.icon.startsWith("http") ? gallery.icon : gallery.name.slice(0, 1).toUpperCase()}
              </Link>
            ))}
        </div>
        <Link href="/connect" title="Kết nối Notion" aria-label="Kết nối Notion" className="btn btn-ghost btn-sm btn-icon">
          +
        </Link>
      </aside>
    </>
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
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: node.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });
  const active = pathname.startsWith(`/galleries/${node.id}`);
  const willNest = nestTarget === node.id;

  return (
    <div>
      <div
        ref={dropRef}
        style={{ paddingLeft: depth * 12 }}
        className={`group flex items-center gap-1 rounded-md ${
          willNest ? "bg-brand-soft ring-1 ring-brand" : isOver ? "bg-stone-200" : ""
        } ${isDragging ? "opacity-40" : ""}`}
      >
        <button
          ref={dragRef}
          {...listeners}
          {...attributes}
          type="button"
          aria-label={`Di chuyển ${node.name}`}
          className="shrink-0 cursor-grab px-0.5 text-line-strong hover:text-muted active:cursor-grabbing"
        >
          ⠿
        </button>
        <Link
          href={`/galleries/${node.id}`}
          aria-current={active ? "page" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs ${
            active ? "bg-brand font-medium text-white" : "text-ink-soft hover:bg-stone-200"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            {node.icon && !node.icon.startsWith("http") ? `${node.icon} ` : ""}
            {node.name}
            {node.autoAdded && <span className="ml-1 text-[10px] opacity-60">liên kết</span>}
          </span>
          <LinkSpinner />
        </Link>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Bỏ “${node.name}” vào thùng rác? Có thể khôi phục lại; Notion không bị đụng tới.`)) {
              void trashGallery(node.id);
            }
          }}
          aria-label={`Bỏ ${node.name} vào thùng rác`}
          title="Bỏ vào thùng rác"
          className="shrink-0 px-1 text-[11px] text-line-strong opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          ✕
        </button>
      </div>

      {node.children.map((child) => (
        <SidebarNode
          key={child.id}
          node={child}
          depth={depth + 1}
          pathname={pathname}
          nestTarget={nestTarget}
        />
      ))}
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
      className={`mt-1 rounded-md border border-dashed px-2 py-1.5 text-center text-[10px] transition-opacity ${
        dragging ? "opacity-100" : "pointer-events-none opacity-0"
      } ${isOver ? "border-brand bg-brand-soft text-brand" : "border-line text-faint"}`}
    >
      Thả vào đây để đưa ra ngoài cùng
    </div>
  );
}
