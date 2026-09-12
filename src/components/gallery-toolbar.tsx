"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  OPERATOR_LABELS,
  RETURN_PARAM,
  moveItem,
  operatorsFor,
  type Filter,
  type FilterOperator,
  type GalleryQuery,
  type SortKey,
} from "@/lib/gallery-query";
import { saveGalleryViewQuery } from "@/app/galleries/[galleryId]/view-actions";

export type ToolbarProperty = {
  notionPropertyId: string;
  name: string;
  /** The type whose operators apply — a formula's resolved type, not "formula". */
  configType: string;
  /** Choices for select-like properties, so a filter value is picked rather than typed. */
  options?: string[];
};

/** Operators that take no value, so the input is hidden for them. */
const VALUELESS = new Set<FilterOperator>(["empty", "not_empty", "is_checked", "is_unchecked"]);

/**
 * Search, filter, sort, group and random pick for a gallery.
 *
 * Search is intentionally transient in the URL. Filter, sort and group belong to the selected
 * persisted view, while the server still applies the whole query against its full snapshot.
 */
export function GalleryToolbar({
  galleryId,
  viewId,
  properties,
  query,
  matchCount,
  totalCount,
  pickTargets,
  randomPickEnabled,
}: {
  galleryId: string;
  viewId: string;
  properties: ToolbarProperty[];
  query: GalleryQuery;
  matchCount: number;
  totalCount: number;
  pickTargets: string[];
  randomPickEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<"filter" | "sort" | null>(null);
  const [draft, setDraft] = useState(query.search);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Adjust the box when the URL changes underneath it — "Xoá hết", or the back button.
  // Done during render rather than in an effect so no keystroke renders a stale value.
  const [lastSearch, setLastSearch] = useState(query.search);
  if (lastSearch !== query.search) {
    setLastSearch(query.search);
    setDraft(query.search);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** Rewrites transient URL parameters, keeping the active view and category axis intact. */
  function commit(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    // Every query change can make a later page empty.
    next.delete("cardPage");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  }

  // Debounced so the grid does not re-render on every keystroke.
  useEffect(() => {
    if (draft === query.search) return;
    const timer = setTimeout(() => commit({ q: draft || null }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const nameOf = (propertyId: string) =>
    properties.find((property) => property.notionPropertyId === propertyId)?.name ?? "?";

  function persist(next: Pick<GalleryQuery, "filters" | "sorts" | "groupBy">) {
    setSaveError(null);
    startTransition(async () => {
      const result = await saveGalleryViewQuery(galleryId, viewId, next);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const setFilters = (filters: Filter[]) => persist({ filters, sorts: query.sorts, groupBy: query.groupBy });
  const setSorts = (sorts: SortKey[]) => persist({ filters: query.filters, sorts, groupBy: query.groupBy });

  function pickRandom() {
    if (pickTargets.length === 0) return;
    const target = pickTargets[Math.floor(Math.random() * pickTargets.length)];
    // Carry the view along, or coming back from the pick lands on an unfiltered grid.
    const back = params.toString();
    router.push(`${pathname}/items/${target}${back ? `?${RETURN_PARAM}=${encodeURIComponent(back)}` : ""}`);
  }

  const filtered = matchCount !== totalCount;

  return (
    <div ref={wrapRef} className="mb-5 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Tìm trong gallery"
        className="w-56 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-600"
      />

      <div className="relative">
        <ToolbarButton active={query.filters.length > 0} onClick={() => setOpen(open === "filter" ? null : "filter")}>
          Lọc{query.filters.length > 0 ? ` (${query.filters.length})` : ""}
        </ToolbarButton>
        {open === "filter" && (
          <Popover>
            <FilterEditor
              properties={properties}
              filters={query.filters}
              nameOf={nameOf}
              onChange={setFilters}
            />
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolbarButton active={query.sorts.length > 0} onClick={() => setOpen(open === "sort" ? null : "sort")}>
          Sắp xếp{query.sorts.length > 0 ? ` (${query.sorts.length})` : ""}
        </ToolbarButton>
        {open === "sort" && (
          <Popover>
            <SortEditor properties={properties} sorts={query.sorts} nameOf={nameOf} onChange={setSorts} />
          </Popover>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-stone-500">
        Nhóm
        <select
          value={query.groupBy ?? ""}
          onChange={(event) =>
            persist({ filters: query.filters, sorts: query.sorts, groupBy: event.target.value || null })
          }
          className="rounded-md border border-stone-300 px-1.5 py-1 text-xs outline-none focus:border-emerald-600"
        >
          <option value="">Không</option>
          {properties.map((property) => (
            <option key={property.notionPropertyId} value={property.notionPropertyId}>
              {property.name}
            </option>
          ))}
        </select>
      </label>

      {randomPickEnabled && (
        <ToolbarButton onClick={pickRandom} disabled={pickTargets.length === 0}>
          🎲 Ngẫu nhiên
        </ToolbarButton>
      )}

      <span className="ml-auto text-xs text-stone-500">
        {filtered ? `${matchCount} / ${totalCount} item` : `${totalCount} item`}
      </span>

      {(filtered || query.sorts.length > 0 || query.groupBy) && (
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDraft("");
            commit({ q: null });
            persist({ filters: [], sorts: [], groupBy: null });
          }}
          className="text-xs text-stone-500 underline hover:text-stone-800"
        >
          Xoá hết
        </button>
      )}
      {saveError && <p className="basis-full text-xs text-red-700">{saveError}</p>}
    </div>
  );
}

function ToolbarButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${
        active
          ? "border-emerald-600 bg-emerald-50 text-emerald-800"
          : "border-stone-300 text-stone-700 hover:border-stone-500"
      }`}
    >
      {children}
    </button>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-0 z-30 mt-1 w-[26rem] rounded-lg border border-stone-200 bg-white p-3 shadow-lg">
      {children}
    </div>
  );
}

/** One sort level: a drag handle, its rank, the property, and whatever controls follow. */
function SortRow({
  sort,
  index,
  name,
  children,
}: {
  sort: SortKey;
  index: number;
  name: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: sort.propertyId });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: sort.propertyId });

  return (
    <div
      ref={dropRef}
      className={`flex items-center gap-1.5 rounded ${isOver ? "bg-emerald-50" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        ref={dragRef}
        {...listeners}
        {...attributes}
        type="button"
        aria-label={`Đổi thứ tự ${name}`}
        className="shrink-0 cursor-grab px-0.5 text-stone-400 active:cursor-grabbing"
      >
        ⠿
      </button>
      <span className="w-3 shrink-0 text-center text-[10px] text-stone-400">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-stone-700">{name}</span>
      {children}
    </div>
  );
}

function FilterEditor({
  properties,
  filters,
  nameOf,
  onChange,
}: {
  properties: ToolbarProperty[];
  filters: Filter[];
  nameOf: (propertyId: string) => string;
  onChange: (filters: Filter[]) => void;
}) {
  const first = properties[0];

  return (
    <div className="flex flex-col gap-2">
      {filters.length === 0 && <p className="text-xs text-stone-400">Chưa có điều kiện nào.</p>}

      {filters.map((filter, index) => {
        const property = properties.find((p) => p.notionPropertyId === filter.propertyId);
        const operators = operatorsFor(property?.configType ?? "rich_text");
        const replace = (next: Partial<Filter>) =>
          onChange(filters.map((entry, i) => (i === index ? { ...entry, ...next } : entry)));

        return (
          <div key={index} className="flex items-center gap-1.5">
            <select
              value={filter.propertyId}
              onChange={(event) => {
                const nextProperty = properties.find((p) => p.notionPropertyId === event.target.value);
                replace({
                  propertyId: event.target.value,
                  operator: operatorsFor(nextProperty?.configType ?? "rich_text")[0],
                  value: "",
                });
              }}
              className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-1 text-xs"
            >
              {properties.map((p) => (
                <option key={p.notionPropertyId} value={p.notionPropertyId}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={filter.operator}
              onChange={(event) => replace({ operator: event.target.value as FilterOperator })}
              className="shrink-0 rounded border border-stone-300 px-1 py-1 text-xs"
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>

            {!VALUELESS.has(filter.operator) &&
              (property?.options?.length ? (
                <select
                  value={filter.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  className="w-28 shrink-0 rounded border border-stone-300 px-1 py-1 text-xs"
                >
                  <option value="">—</option>
                  {property.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={property?.configType === "date" ? "date" : "text"}
                  value={filter.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  className="w-28 shrink-0 rounded border border-stone-300 px-1 py-1 text-xs"
                />
              ))}

            <button
              type="button"
              aria-label={`Bỏ điều kiện ${nameOf(filter.propertyId)}`}
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
              className="shrink-0 px-1 text-stone-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        );
      })}

      {first && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...filters,
              { propertyId: first.notionPropertyId, operator: operatorsFor(first.configType)[0], value: "" },
            ])
          }
          className="self-start text-xs text-emerald-700 hover:underline"
        >
          + Thêm điều kiện
        </button>
      )}
    </div>
  );
}

/**
 * Sort levels, reorderable by dragging.
 *
 * Order is the whole meaning of the list — the first key decides, the rest only break ties —
 * so moving a level has to be a direct action rather than remove-and-re-add. The keyboard
 * sensor keeps that reachable without a pointer: focus a handle, space to lift, arrows to
 * move.
 */
function SortEditor({
  properties,
  sorts,
  nameOf,
  onChange,
}: {
  properties: ToolbarProperty[];
  sorts: SortKey[];
  nameOf: (propertyId: string) => string;
  onChange: (sorts: SortKey[]) => void;
}) {
  const unused = properties.filter((p) => !sorts.some((s) => s.propertyId === p.notionPropertyId));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = sorts.findIndex((sort) => sort.propertyId === String(active.id));
    const to = sorts.findIndex((sort) => sort.propertyId === String(over.id));
    if (from === -1 || to === -1) return;
    onChange(moveItem(sorts, from, to));
  }

  return (
    <div className="flex flex-col gap-2">
      {sorts.length === 0 && <p className="text-xs text-stone-400">Chưa sắp xếp theo gì.</p>}

      <DndContext id="sort-levels" sensors={sensors} onDragEnd={handleDragEnd}>
        {sorts.map((sort, index) => (
          <SortRow key={sort.propertyId} sort={sort} index={index} name={nameOf(sort.propertyId)}>
            <select
              value={sort.direction}
              onChange={(event) =>
                onChange(
                  sorts.map((entry, i) =>
                    i === index ? { ...entry, direction: event.target.value as "asc" | "desc" } : entry,
                  ),
                )
              }
              className="shrink-0 rounded border border-stone-300 px-1 py-1 text-xs"
            >
              <option value="asc">Tăng dần</option>
              <option value="desc">Giảm dần</option>
            </select>
            <button
              type="button"
              aria-label={`Bỏ sắp xếp theo ${nameOf(sort.propertyId)}`}
              onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              className="shrink-0 px-1 text-stone-400 hover:text-red-600"
            >
              ✕
            </button>
          </SortRow>
        ))}
      </DndContext>

      {unused.length > 0 && (
        <select
          value=""
          onChange={(event) =>
            event.target.value && onChange([...sorts, { propertyId: event.target.value, direction: "asc" }])
          }
          className="self-start rounded border border-stone-300 px-1.5 py-1 text-xs"
        >
          <option value="">+ Thêm mức sắp xếp</option>
          {unused.map((property) => (
            <option key={property.notionPropertyId} value={property.notionPropertyId}>
              {property.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
