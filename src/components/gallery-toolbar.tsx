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
  isFilterComplete,
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
  const incomingViewState = JSON.stringify({ filters: query.filters, sorts: query.sorts, groupBy: query.groupBy });
  const [lastViewState, setLastViewState] = useState(incomingViewState);
  const [viewQuery, setViewQuery] = useState<Pick<GalleryQuery, "filters" | "sorts" | "groupBy">>({
    filters: query.filters,
    sorts: query.sorts,
    groupBy: query.groupBy,
  });
  if (lastViewState !== incomingViewState) {
    setLastViewState(incomingViewState);
    setViewQuery({ filters: query.filters, sorts: query.sorts, groupBy: query.groupBy });
  }
  const activeQuery: GalleryQuery = { ...query, ...viewQuery };
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
    // Replace, not push: every pause in typing would otherwise become a Back step.
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
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

  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  function persist(next: Pick<GalleryQuery, "filters" | "sorts" | "groupBy">, immediate = false) {
    // Controls can change twice before a Server Component refresh returns. Keep an
    // optimistic query locally, otherwise the second save would overwrite the first.
    setViewQuery(next);
    setSaveError(null);
    // Typing a filter value used to save the view and re-render the Gallery on every
    // keystroke. Saves now wait for a pause; picks from a list still land at once.
    window.clearTimeout(saveTimer.current);
    const save = () =>
      startTransition(async () => {
        const result = await saveGalleryViewQuery(galleryId, viewId, next);
        if (result.error) {
          setSaveError(result.error);
          return;
        }
        router.refresh();
      });
    if (immediate) save();
    else saveTimer.current = window.setTimeout(save, 400);
  }

  const setFilters = (filters: Filter[]) => persist({ ...viewQuery, filters });
  const setSorts = (sorts: SortKey[]) => persist({ ...viewQuery, sorts }, true);

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
      <div className="relative w-full sm:w-64">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-faint">
          ⌕
        </span>
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tìm trong gallery"
          aria-label="Tìm trong gallery"
          className="input input-sm pl-7"
        />
      </div>

      <div className="relative">
        <ToolbarButton active={activeQuery.filters.length > 0} onClick={() => setOpen(open === "filter" ? null : "filter")}>
          Lọc{activeQuery.filters.length > 0 ? ` (${activeQuery.filters.length})` : ""}
        </ToolbarButton>
        {open === "filter" && (
          <Popover>
            <FilterEditor
              properties={properties}
              filters={activeQuery.filters}
              nameOf={nameOf}
              onChange={setFilters}
            />
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolbarButton active={activeQuery.sorts.length > 0} onClick={() => setOpen(open === "sort" ? null : "sort")}>
          Sắp xếp{activeQuery.sorts.length > 0 ? ` (${activeQuery.sorts.length})` : ""}
        </ToolbarButton>
        {open === "sort" && (
          <Popover>
            <SortEditor properties={properties} sorts={activeQuery.sorts} nameOf={nameOf} onChange={setSorts} />
          </Popover>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Nhóm
        <select
          value={activeQuery.groupBy ?? ""}
          onChange={(event) =>
            persist({ ...viewQuery, groupBy: event.target.value || null }, true)
          }
          className={`input input-sm w-auto max-w-44 ${activeQuery.groupBy ? "border-brand" : ""}`}
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

      <span className="ml-auto flex items-center gap-3">
        {saving && <span className="text-xs text-faint">Đang lưu view…</span>}
        {filtered && (
          <span className="text-xs text-muted tabular-nums">
            {matchCount} / {totalCount} item
          </span>
        )}
        {(filtered || activeQuery.filters.length > 0 || activeQuery.sorts.length > 0 || activeQuery.groupBy) && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft("");
              commit({ q: null });
              persist({ filters: [], sorts: [], groupBy: null }, true);
            }}
            className="btn btn-ghost btn-sm"
          >
            Xoá hết
          </button>
        )}
      </span>
      {saveError && <p className="basis-full text-xs text-danger">{saveError}</p>}
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
      aria-pressed={active}
      className={`btn btn-secondary btn-sm ${active ? "btn-active" : ""}`}
    >
      {children}
    </button>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return <div className="popover absolute left-0 z-30 mt-1 w-[min(28rem,calc(100vw-2rem))] p-3">{children}</div>;
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
      className={`flex items-center gap-1.5 rounded-md ${isOver ? "bg-brand-soft" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        ref={dragRef}
        {...listeners}
        {...attributes}
        type="button"
        aria-label={`Đổi thứ tự ${name}`}
        className="shrink-0 cursor-grab px-0.5 text-faint hover:text-ink active:cursor-grabbing"
      >
        ⠿
      </button>
      <span className="w-3 shrink-0 text-center text-[10px] text-faint">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{name}</span>
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
      {filters.length === 0 && <p className="text-xs text-faint">Chưa có điều kiện nào.</p>}

      {filters.map((filter, index) => {
        const property = properties.find((p) => p.notionPropertyId === filter.propertyId);
        const operators = operatorsFor(property?.configType ?? "rich_text");
        const replace = (next: Partial<Filter>) =>
          onChange(filters.map((entry, i) => (i === index ? { ...entry, ...next } : entry)));
        const pendingValue = !isFilterComplete(filter);

        return (
          <div key={index} className="flex items-center gap-1.5">
            <select
              aria-label="Property"
              value={filter.propertyId}
              onChange={(event) => {
                const nextProperty = properties.find((p) => p.notionPropertyId === event.target.value);
                replace({
                  propertyId: event.target.value,
                  operator: operatorsFor(nextProperty?.configType ?? "rich_text")[0],
                  value: "",
                });
              }}
              className="input input-sm min-w-0 flex-1 px-1.5"
            >
              {properties.map((p) => (
                <option key={p.notionPropertyId} value={p.notionPropertyId}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Điều kiện"
              value={filter.operator}
              onChange={(event) => replace({ operator: event.target.value as FilterOperator })}
              className="input input-sm w-auto shrink-0 px-1.5"
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
                  aria-label="Giá trị"
                  value={filter.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  title={pendingValue ? "Chọn giá trị để áp dụng điều kiện này" : undefined}
                  className={`input input-sm w-32 shrink-0 px-1.5 ${pendingValue ? "border-amber-400" : ""}`}
                >
                  <option value="">— chọn —</option>
                  {property.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="Giá trị"
                  type={property?.configType === "date" ? "date" : "text"}
                  inputMode={property?.configType === "number" ? "decimal" : undefined}
                  value={filter.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  placeholder="Giá trị"
                  title={pendingValue ? "Nhập giá trị để áp dụng điều kiện này" : undefined}
                  className={`input input-sm w-32 shrink-0 px-1.5 ${pendingValue ? "border-amber-400" : ""}`}
                />
              ))}

            <button
              type="button"
              aria-label={`Bỏ điều kiện ${nameOf(filter.propertyId)}`}
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon shrink-0 hover:text-danger"
            >
              ✕
            </button>
          </div>
        );
      })}

      {filters.some((filter) => !isFilterComplete(filter)) && (
        <p className="text-[11px] text-amber-700">Điều kiện chưa có giá trị thì chưa được áp dụng.</p>
      )}

      {first && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...filters,
              { propertyId: first.notionPropertyId, operator: operatorsFor(first.configType)[0], value: "" },
            ])
          }
          className="btn btn-ghost btn-sm self-start text-brand"
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
      {sorts.length === 0 && <p className="text-xs text-faint">Chưa sắp xếp theo gì.</p>}

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
              aria-label={`Chiều sắp xếp ${nameOf(sort.propertyId)}`}
              className="input input-sm w-auto shrink-0 px-1.5"
            >
              <option value="asc">Tăng dần</option>
              <option value="desc">Giảm dần</option>
            </select>
            <button
              type="button"
              aria-label={`Bỏ sắp xếp theo ${nameOf(sort.propertyId)}`}
              onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon shrink-0 hover:text-danger"
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
          aria-label="Thêm mức sắp xếp"
          className="input input-sm w-auto self-start"
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
