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
import { Icon, type IconName } from "@/components/icons";
import { useDismiss } from "@/lib/use-dismiss";

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

type ViewQuery = Pick<GalleryQuery, "filters" | "sorts" | "groupBy">;

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
  const [open, setOpen] = useState<"filter" | "sort" | "group" | null>(null);
  const [draft, setDraft] = useState(query.search);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const incoming: ViewQuery = { filters: query.filters, sorts: query.sorts, groupBy: query.groupBy };
  const incomingViewState = JSON.stringify(incoming);
  const [lastViewState, setLastViewState] = useState(incomingViewState);
  const [viewQuery, setViewQuery] = useState<ViewQuery>(incoming);
  if (lastViewState !== incomingViewState) {
    setLastViewState(incomingViewState);
    setViewQuery(incoming);
  }
  const activeQuery: GalleryQuery = { ...query, ...viewQuery };
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useDismiss(wrapRef, open !== null, () => setOpen(null));

  // Adjust the box when the URL changes underneath it — a cleared category, or the back
  // button. Done during render rather than in an effect so no keystroke renders a stale value.
  const [lastSearch, setLastSearch] = useState(query.search);
  if (lastSearch !== query.search) {
    setLastSearch(query.search);
    setDraft(query.search);
  }

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

  // "/" jumps to the search box, as in most apps with one — unless the reader is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      // The detail popup and the search palette sit above the grid and own the keyboard.
      if (document.querySelector("[aria-modal=true]")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const nameOf = (propertyId: string) =>
    properties.find((property) => property.notionPropertyId === propertyId)?.name ?? "?";

  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  function persist(next: ViewQuery, immediate = false) {
    // Controls can change twice before a Server Component refresh returns. Keep an
    // optimistic query locally, otherwise the second save would overwrite the first.
    setViewQuery(next);
    setSaveError(null);
    // Typing a filter value used to save the view and re-render the Gallery on every
    // keystroke. Saves now wait for a pause; picks from a list still land at once.
    window.clearTimeout(saveTimer.current);
    const save = () =>
      startTransition(async () => {
        try {
          const result = await saveGalleryViewQuery(galleryId, viewId, next);
          if (!result.error) return router.refresh();
          setSaveError(result.error);
        } catch {
          setSaveError("Không lưu được view. Thử lại sau giây lát.");
        }
        // Nothing was saved, so the controls go back to what the grid is really showing.
        setViewQuery(incoming);
      });
    if (immediate) save();
    else saveTimer.current = window.setTimeout(save, 400);
  }

  const setFilters = (filters: Filter[]) => persist({ ...viewQuery, filters });
  const setSorts = (sorts: SortKey[]) => persist({ ...viewQuery, sorts }, true);
  const setGroup = (groupBy: string | null) => persist({ ...viewQuery, groupBy }, true);

  function pickRandom() {
    if (pickTargets.length === 0) return;
    const target = pickTargets[Math.floor(Math.random() * pickTargets.length)];
    // Carry the view along, or coming back from the pick lands on an unfiltered grid.
    const back = params.toString();
    router.push(`${pathname}/items/${target}${back ? `?${RETURN_PARAM}=${encodeURIComponent(back)}` : ""}`);
  }

  const toggle = (panel: "filter" | "sort" | "group") => setOpen(open === panel ? null : panel);
  const filterCount = activeQuery.filters.filter(isFilterComplete).length;

  return (
    <div ref={wrapRef} className="flex flex-wrap items-center gap-1.5">
      <div className="relative w-full sm:w-52">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          ref={searchRef}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && draft) setDraft("");
          }}
          placeholder="Tìm trong gallery"
          aria-label="Tìm trong gallery"
          className="h-8 w-full rounded-full bg-subtle pr-8 pl-9 text-[13px] text-ink ring-1 ring-line outline-none ring-inset transition-shadow placeholder:text-faint focus:bg-surface focus:ring-2 focus:ring-brand/40"
        />
        {!draft && <kbd className="kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</kbd>}
      </div>

      <div className="relative">
        <ToolbarButton icon="filter" active={filterCount > 0} expanded={open === "filter"} onClick={() => toggle("filter")}>
          Lọc{filterCount > 0 ? ` · ${filterCount}` : ""}
        </ToolbarButton>
        {open === "filter" && (
          <Popover>
            <FilterEditor properties={properties} filters={activeQuery.filters} nameOf={nameOf} onChange={setFilters} />
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolbarButton icon="sort" active={activeQuery.sorts.length > 0} expanded={open === "sort"} onClick={() => toggle("sort")}>
          Sắp xếp{activeQuery.sorts.length > 0 ? ` · ${activeQuery.sorts.length}` : ""}
        </ToolbarButton>
        {open === "sort" && (
          <Popover>
            <SortEditor properties={properties} sorts={activeQuery.sorts} nameOf={nameOf} onChange={setSorts} />
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolbarButton icon="layers" active={Boolean(activeQuery.groupBy)} expanded={open === "group"} onClick={() => toggle("group")}>
          {activeQuery.groupBy ? `Nhóm · ${nameOf(activeQuery.groupBy)}` : "Nhóm"}
        </ToolbarButton>
        {open === "group" && (
          <Popover narrow>
            <div role="listbox" aria-label="Nhóm theo" className="flex max-h-72 flex-col overflow-y-auto">
              {[{ notionPropertyId: "", name: "Không nhóm" }, ...properties].map((property) => {
                const selected = (activeQuery.groupBy ?? "") === property.notionPropertyId;
                return (
                  <button
                    key={property.notionPropertyId || "none"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setGroup(property.notionPropertyId || null);
                      setOpen(null);
                    }}
                    className={`menu-item ${selected ? "font-medium text-ink" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{property.name}</span>
                    {selected && <Icon name="check" className="size-4 text-brand-ink" />}
                  </button>
                );
              })}
            </div>
          </Popover>
        )}
      </div>

      {randomPickEnabled && (
        <button
          type="button"
          onClick={pickRandom}
          disabled={pickTargets.length === 0}
          aria-label="Mở một item ngẫu nhiên"
          title="Mở một item ngẫu nhiên"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <Icon name="shuffle" />
        </button>
      )}

      <span className="flex items-center gap-2 pl-1 text-xs text-faint tabular-nums">
        {saving && (
          <span className="flex items-center gap-1.5">
            <span className="size-3 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
            Đang lưu view
          </span>
        )}
        {!saving && matchCount !== totalCount && (
          <span>
            {matchCount} / {totalCount}
          </span>
        )}
      </span>
      {saveError && <p className="basis-full text-xs text-danger">{saveError}</p>}
    </div>
  );
}

function ToolbarButton({
  children,
  icon,
  active,
  expanded,
  onClick,
}: {
  children: React.ReactNode;
  icon: IconName;
  active?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-pressed={active}
      className={`btn btn-sm max-w-56 ${active ? "btn-secondary btn-active" : "btn-ghost"} ${expanded && !active ? "bg-subtle" : ""}`}
    >
      <Icon name={icon} />
      <span className="truncate">{children}</span>
    </button>
  );
}

function Popover({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  // On a phone the button may sit anywhere along the row; the panel spans the screen instead
  // of hanging off its right edge.
  return (
    <div
      // Anchored by its right edge: the toolbar sits at the right of its row, and a panel
      // hanging rightwards from "Lọc" ran off the screen.
      className={`popover absolute top-full right-0 z-30 mt-2 p-3 max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:w-auto ${
        narrow ? "w-60 p-1.5" : "w-[30rem]"
      }`}
    >
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
      className={`flex items-center gap-1.5 rounded-xl p-1 ${isOver ? "bg-brand-soft" : ""} ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        ref={dragRef}
        {...listeners}
        {...attributes}
        type="button"
        aria-label={`Đổi thứ tự ${name}`}
        className="shrink-0 cursor-grab rounded-md p-0.5 text-faint hover:text-ink active:cursor-grabbing"
      >
        <Icon name="grip" className="size-4" />
      </button>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-subtle text-[10px] font-medium text-muted">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{name}</span>
      {children}
    </div>
  );
}

function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 px-1">
      <p className="text-xs font-medium text-muted">{children}</p>
      {action}
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
      <PanelTitle
        action={
          filters.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="text-xs text-muted hover:text-danger">
              Xoá tất cả
            </button>
          )
        }
      >
        Hiện item thoả mọi điều kiện — lưu vào view này
      </PanelTitle>
      {filters.length === 0 && <p className="px-1 text-[13px] text-faint">Chưa có điều kiện nào.</p>}

      {filters.map((filter, index) => {
        const property = properties.find((p) => p.notionPropertyId === filter.propertyId);
        const operators = operatorsFor(property?.configType ?? "rich_text");
        const replace = (next: Partial<Filter>) =>
          onChange(filters.map((entry, i) => (i === index ? { ...entry, ...next } : entry)));
        const pendingValue = !isFilterComplete(filter);

        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
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
              className="input input-sm min-w-0 flex-1"
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
              className="input input-sm w-auto shrink-0"
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
                  className={`input input-sm w-32 shrink-0 ${pendingValue ? "border-warn" : ""}`}
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
                  className={`input input-sm w-32 shrink-0 ${pendingValue ? "border-warn" : ""}`}
                />
              ))}

            <button
              type="button"
              aria-label={`Bỏ điều kiện ${nameOf(filter.propertyId)}`}
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon shrink-0 hover:text-danger"
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}

      {filters.some((filter) => !isFilterComplete(filter)) && (
        <p className="px-1 text-[11px] text-warn">Điều kiện chưa có giá trị thì chưa được áp dụng.</p>
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
          className="btn btn-ghost btn-sm self-start text-brand-ink"
        >
          <Icon name="plus" />
          Thêm điều kiện
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
    <div className="flex flex-col gap-1.5">
      <PanelTitle
        action={
          sorts.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="text-xs text-muted hover:text-danger">
              Bỏ sắp xếp
            </button>
          )
        }
      >
        Mức trên quyết định trước — kéo để đổi thứ tự
      </PanelTitle>
      {sorts.length === 0 && <p className="px-1 text-[13px] text-faint">Đang theo thứ tự của Notion.</p>}

      <DndContext id="sort-levels" sensors={sensors} onDragEnd={handleDragEnd}>
        {sorts.map((sort, index) => (
          <SortRow key={sort.propertyId} sort={sort} index={index} name={nameOf(sort.propertyId)}>
            <div className="segmented shrink-0">
              {(["asc", "desc"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  aria-pressed={sort.direction === direction}
                  onClick={() =>
                    onChange(sorts.map((entry, i) => (i === index ? { ...entry, direction } : entry)))
                  }
                  aria-label={`${direction === "asc" ? "Tăng dần" : "Giảm dần"} theo ${nameOf(sort.propertyId)}`}
                >
                  {direction === "asc" ? "A → Z" : "Z → A"}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={`Bỏ sắp xếp theo ${nameOf(sort.propertyId)}`}
              onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon shrink-0 hover:text-danger"
            >
              <Icon name="x" />
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
          className="input input-sm mt-1 w-auto self-start"
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
