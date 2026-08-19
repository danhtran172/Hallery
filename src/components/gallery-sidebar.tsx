"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { buildGalleryTree, filterTree, type GalleryNode, type GalleryTreeNode } from "@/lib/gallery-tree";
import { nestGallery, reorderGallery, restoreGallery, trashGallery } from "@/app/sidebar-actions";

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

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-stone-200 bg-stone-50 py-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Mở rộng thanh bên"
          title="Mở rộng thanh bên"
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:border-stone-500"
        >
          »
        </button>
        {galleries.slice(0, 12).map((gallery) => (
          <Link
            key={gallery.id}
            href={`/galleries/${gallery.id}`}
            title={gallery.name}
            className={`flex h-8 w-8 items-center justify-center rounded text-xs ${
              pathname.startsWith(`/galleries/${gallery.id}`)
                ? "bg-emerald-600 text-white"
                : "bg-white text-stone-600 hover:bg-stone-200"
            }`}
          >
            {gallery.icon && !gallery.icon.startsWith("http") ? gallery.icon : gallery.name.slice(0, 1)}
          </Link>
        ))}
      </aside>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 border-r border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-emerald-800 hover:underline">
          Hallery
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Thu gọn thanh bên"
          title="Thu gọn thanh bên"
          className="rounded border border-stone-300 px-1.5 py-0.5 text-xs text-stone-500 hover:border-stone-500"
        >
          «
        </button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tìm gallery"
        className="w-full rounded-md border border-stone-300 px-2 py-1 text-xs outline-none focus:border-emerald-600"
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
            <p className="px-1 py-2 text-[11px] text-stone-400">
              {search ? "Không có gallery nào khớp." : "Chưa có gallery nào."}
            </p>
          )}
          {tree.map((node) => (
            <SidebarNode
              key={node.id}
              node={node}
              depth={0}
              pathname={pathname}
              nestTarget={nestTarget}
            />
          ))}
          <RootDropZone active={tree.length > 0} />
        </div>
      </DndContext>

      <div className="border-t border-stone-200 pt-2">
        <button
          type="button"
          onClick={() => setShowTrash((v) => !v)}
          aria-expanded={showTrash}
          className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-wide text-stone-400 hover:text-stone-600"
        >
          <span>Thùng rác</span>
          <span>{trashed.length}</span>
        </button>
        {showTrash && (
          <div className="mt-1 flex flex-col gap-1">
            {trashed.length === 0 && <p className="px-1 text-[11px] text-stone-400">Trống.</p>}
            {trashed.map((gallery) => (
              <div key={gallery.id} className="flex items-center gap-1 px-1 text-xs text-stone-500">
                <span className="min-w-0 flex-1 truncate line-through">{gallery.name}</span>
                <button
                  type="button"
                  onClick={() => restoreGallery(gallery.id)}
                  className="shrink-0 text-[11px] text-emerald-700 hover:underline"
                >
                  Khôi phục
                </button>
              </div>
            ))}
            <p className="px-1 pt-1 text-[10px] leading-snug text-stone-400">
              Bỏ vào đây chỉ là Hallery ngừng quản lý. Database trong Notion không hề bị đụng tới.
            </p>
          </div>
        )}
      </div>
    </aside>
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
        className={`group flex items-center gap-1 rounded ${
          willNest ? "bg-emerald-100 ring-1 ring-emerald-500" : isOver ? "bg-stone-200" : ""
        } ${isDragging ? "opacity-40" : ""}`}
      >
        <button
          ref={dragRef}
          {...listeners}
          {...attributes}
          type="button"
          aria-label={`Di chuyển ${node.name}`}
          className="shrink-0 cursor-grab px-0.5 text-stone-300 hover:text-stone-500 active:cursor-grabbing"
        >
          ⠿
        </button>
        <Link
          href={`/galleries/${node.id}`}
          className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-xs ${
            active ? "bg-emerald-600 font-medium text-white" : "text-stone-700 hover:bg-stone-200"
          }`}
        >
          {node.icon && !node.icon.startsWith("http") ? `${node.icon} ` : ""}
          {node.name}
          {node.autoAdded && <span className="ml-1 text-[10px] opacity-60">liên kết</span>}
        </Link>
        <button
          type="button"
          onClick={() => trashGallery(node.id)}
          aria-label={`Bỏ ${node.name} vào thùng rác`}
          title="Bỏ vào thùng rác"
          className="shrink-0 px-1 text-[11px] text-stone-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
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
  if (!active) return null;

  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded border border-dashed px-2 py-1.5 text-center text-[10px] ${
        isOver ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-stone-200 text-stone-400"
      }`}
    >
      Thả vào đây để đưa ra ngoài cùng
    </div>
  );
}
