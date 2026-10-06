"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PageObjectResponse } from "@notionhq/client";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { saveTableLayout } from "@/app/galleries/[galleryId]/view-actions";
import { Icon } from "@/components/icons";
import type { GridProperty } from "@/components/card-grid";
import { GalleryTableRow, buildTableCells, type TableCellModel } from "@/components/gallery-table";
import { TITLE_FIELD_ID } from "@/lib/card-layout";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { KIND_OPTIONS, allowsAffix } from "@/lib/display-kinds";
import { CONTENT_IMAGE, PAGE_COVER, PROPERTY_PREFIX } from "@/lib/notion-cover";
import {
  COVER_COLUMN_ID,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ROW_NUMBER_WIDTH,
  clampColumnWidth,
  resolveTableColumns,
  stickyColumnCount,
  tableTracks,
  thumbBox,
  widthVariables,
  type ColumnAlign,
  type CoverPlacement,
  type TableColumn,
  type TableDensity,
  type TableLayout,
  type ThumbShape,
  type ThumbSize,
} from "@/lib/table-layout";

export type EditorProperty = GridProperty & {
  /** The Hallery name (rename applied). */
  name: string;
  typeLabel: string;
  /** The type whose display styles apply — a formula's output, not "formula". */
  configType: string;
  notionPropertyType: string;
  isMissing: boolean;
  disabled: boolean;
};

export type SampleRow = { page: PageObjectResponse; title: string; icon: string | null };

type DropTarget = { kind: "slot"; index: number } | { kind: "tray" } | null;

/** "col:<id>" for a column in the table, "tray:<id>" for one waiting to be added. */
const dragId = (place: "col" | "tray", id: string) => `${place}:${id}`;
const parseDragId = (value: string) => {
  const at = value.indexOf(":");
  return { place: value.slice(0, at) as "col" | "tray", id: value.slice(at + 1) };
};

/**
 * A table view's columns, arranged on a live preview: drag a property from the tray onto
 * the header to add it, drag headers to reorder, drag one back to the tray to hide it.
 * Clicking a header opens its settings — name, width, alignment, wrapping, and a display
 * style of its own for this table. The picture and the table-wide options sit alongside.
 * Every drag has a button twin (the tray chips add, the panel moves and hides), so the
 * editor works without a pointer too.
 */
export function TableColumnsEditor({
  galleryId,
  viewId,
  initialLayout,
  initialCoverSource,
  imageProperties,
  titleName,
  properties,
  samples,
}: {
  galleryId: string;
  viewId: string;
  initialLayout: TableLayout;
  initialCoverSource: string;
  imageProperties: string[];
  titleName: string;
  properties: EditorProperty[];
  samples: SampleRow[];
}) {
  const router = useRouter();
  const byId = new Map(properties.map((property) => [property.notionPropertyId, property]));
  const [layout, setLayout] = useState<TableLayout>(() => ({
    ...initialLayout,
    columns: initialLayout.columns.filter(
      (column) => column.id === TITLE_FIELD_ID || column.id === COVER_COLUMN_ID || byId.has(column.id),
    ),
  }));
  const [coverSource, setCoverSource] = useState(initialCoverSource);
  // Shared Hallery names, by property id: a rename belongs to the property everywhere, so it
  // is kept apart from the layout and only the ones that changed travel with a save.
  const [savedNames, setSavedNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      properties.map((property) => [property.notionPropertyId, parseDisplayConfig(property.displayConfig).nameOverride?.trim() ?? ""]),
    ),
  );
  const [names, setNames] = useState(savedNames);
  const [selected, setSelected] = useState<string>(TITLE_FIELD_ID);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget>(null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const signature = JSON.stringify({ layout, coverSource, names });
  const [savedSignature, setSavedSignature] = useState(signature);
  const dirty = signature !== savedSignature;
  const [justSaved, setJustSaved] = useState(false);
  if (justSaved && dirty) setJustSaved(false);

  // Leaving with unsaved changes asks first, as the card editor does.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      if (!window.confirm("Cột bảng có thay đổi chưa lưu. Rời trang và bỏ các thay đổi đó?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  /* ── Column edits ─────────────────────────────────────────────────────── */

  const nameOf = (id: string) => names[id]?.trim() || byId.get(id)?.notionPropertyName || id;
  const labelOf = (id: string) => (id === TITLE_FIELD_ID ? titleName : id === COVER_COLUMN_ID ? "Ảnh" : nameOf(id));

  /** Puts a column at `at` (an insertion index), moving it if it is already shown. */
  function placeColumn(id: string, at: number) {
    setLayout((current) => {
      const columns = [...current.columns];
      const from = columns.findIndex((column) => column.id === id);
      let to = Math.max(0, Math.min(at, columns.length));
      let column: TableColumn = { id, width: id === COVER_COLUMN_ID ? 0 : DEFAULT_COLUMN_WIDTH };
      if (from >= 0) {
        [column] = columns.splice(from, 1);
        if (from < to) to -= 1;
      }
      columns.splice(to, 0, column);
      const cover = id === COVER_COLUMN_ID ? { ...current.cover, placement: "column" as const } : current.cover;
      return { ...current, columns, cover };
    });
    setSelected(id);
  }

  function hideColumn(id: string) {
    if (id === TITLE_FIELD_ID) return;
    setLayout((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.id !== id),
      cover: id === COVER_COLUMN_ID ? { ...current.cover, placement: "none" } : current.cover,
    }));
    setSelected(TITLE_FIELD_ID);
  }

  function nudgeColumn(id: string, by: -1 | 1) {
    const index = layout.columns.findIndex((column) => column.id === id);
    if (index < 0) return;
    const target = index + by;
    if (target < 0 || target >= layout.columns.length) return;
    // An insertion index: one further right when moving right, past the neighbour.
    placeColumn(id, by === 1 ? target + 1 : target);
  }

  const patchColumn = (id: string, patch: Partial<TableColumn>) =>
    setLayout((current) => ({
      ...current,
      columns: current.columns.map((column) => {
        if (column.id !== id) return column;
        const next: TableColumn = { ...column, ...patch };
        // Undefined means "follow the default" — drop the key rather than store it.
        for (const key of Object.keys(next) as (keyof TableColumn)[]) if (next[key] === undefined) delete next[key];
        return next;
      }),
    }));

  function setPlacement(placement: CoverPlacement) {
    setLayout((current) => {
      const without = current.columns.filter((column) => column.id !== COVER_COLUMN_ID);
      const titleAt = without.findIndex((column) => column.id === TITLE_FIELD_ID);
      const columns =
        placement === "column"
          ? [...without.slice(0, titleAt), { id: COVER_COLUMN_ID, width: 0 }, ...without.slice(titleAt)]
          : without;
      return { ...current, columns, cover: { ...current.cover, placement } };
    });
    if (placement !== "column" && selected === COVER_COLUMN_ID) setSelected(TITLE_FIELD_ID);
  }

  /* ── Drag and drop ────────────────────────────────────────────────────── */

  function targetOf(event: DragMoveEvent | DragEndEvent): DropTarget {
    const { over, active } = event;
    if (!over) return null;
    const overId = String(over.id);
    if (overId === "tray") return { kind: "tray" };
    if (!overId.startsWith("slot:")) return null;
    const index = Number(overId.slice(5));
    const rect = active.rect.current.translated;
    const middle = rect ? rect.left + rect.width / 2 : over.rect.left;
    return { kind: "slot", index: middle < over.rect.left + over.rect.width / 2 ? index : index + 1 };
  }

  function onDragEnd(event: DragEndEvent) {
    const target = targetOf(event);
    const { place, id } = parseDragId(String(event.active.id));
    setDragging(null);
    setDrop(null);
    if (!target) return;
    if (target.kind === "tray") {
      if (place === "col") hideColumn(id);
      return;
    }
    placeColumn(id, target.index);
  }

  /* ── Preview ──────────────────────────────────────────────────────────── */

  const resolved = resolveTableColumns(layout, properties);
  const stickyCount = stickyColumnCount(layout, resolved);
  const cells: TableCellModel[] = buildTableCells(resolved, layout, stickyCount);
  const widths = resolved.map((column) => column.width);
  const thumb = layout.cover.placement === "none" ? null : thumbBox(layout.cover);
  const round = layout.cover.shape === "circle";

  const shown = new Set(layout.columns.map((column) => column.id));
  const tray = [
    ...(layout.cover.placement !== "column" ? [{ id: COVER_COLUMN_ID, label: "Ảnh", hint: "Cột ảnh riêng" }] : []),
    // Buttons last, as in every property list: they act rather than hold a value.
    ...[...properties]
      .filter((property) => !shown.has(property.notionPropertyId))
      .sort((a, b) => Number(a.notionPropertyType === "button") - Number(b.notionPropertyType === "button"))
      .map((property) => ({
        id: property.notionPropertyId,
        label: nameOf(property.notionPropertyId),
        hint: property.typeLabel,
        button: property.notionPropertyType === "button",
      })),
  ];

  const selectedColumn = layout.columns.find((column) => column.id === selected) ?? layout.columns[0];
  const selectedIndex = layout.columns.indexOf(selectedColumn);

  function save() {
    setError(null);
    const next: TableLayout = {
      ...layout,
      columns: layout.columns.map((column) =>
        column.id === COVER_COLUMN_ID ? column : { ...column, width: clampColumnWidth(column.width) },
      ),
    };
    startSaving(async () => {
      try {
        const renamed = Object.fromEntries(Object.entries(names).filter(([id, name]) => name.trim() !== savedNames[id]));
        const result = await saveTableLayout(galleryId, viewId, next, coverSource, renamed);
        if (result.error) return setError(result.error);
        const trimmed = Object.fromEntries(Object.entries(names).map(([id, name]) => [id, name.trim()]));
        setLayout(next);
        setNames(trimmed);
        setSavedNames(trimmed);
        setSavedSignature(JSON.stringify({ layout: next, coverSource, names: trimmed }));
        setJustSaved(true);
        router.refresh();
      } catch {
        setError("Không lưu được. Thử lại sau giây lát.");
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }: DragStartEvent) => setDragging(parseDragId(String(active.id)).id)}
      onDragMove={(event) => setDrop(targetOf(event))}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setDrop(null);
      }}
    >
      <div className="flex flex-col gap-5">
        {/* 1 · The table itself, live */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Xem trước</h2>
            <p className="text-xs text-muted">Kéo tiêu đề cột để đổi thứ tự · bấm để chỉnh · kéo xuống khay để ẩn</p>
          </div>
          <div className="g-table-scroll">
            <div
              role="table"
              className="g-table"
              data-density={layout.density}
              data-stripes={layout.stripes ? "true" : "false"}
              style={
                {
                  ...widthVariables(widths),
                  "--table-cols": tableTracks(resolved.length, layout.rowNumbers),
                  width: widths.reduce((sum, width) => sum + width, layout.rowNumbers ? ROW_NUMBER_WIDTH : 0),
                } as React.CSSProperties
              }
            >
              <div role="row" className="g-thead">
                {layout.rowNumbers && (
                  <div
                    role="columnheader"
                    className={`g-th justify-end${stickyCount ? " g-sticky" : ""}`}
                    style={stickyCount ? { left: 0 } : undefined}
                  >
                    #
                  </div>
                )}
                {resolved.map((column, index) => (
                  <HeaderSlot
                    key={column.id}
                    id={column.id}
                    index={index}
                    label={column.label || labelOf(column.id)}
                    align={cells[index].align}
                    left={cells[index].left}
                    selected={selected === column.id}
                    dropSide={
                      drop?.kind === "slot" && dragging
                        ? drop.index === index
                          ? "left"
                          : drop.index === index + 1 && index === resolved.length - 1
                            ? "right"
                            : null
                        : null
                    }
                    onSelect={() => setSelected(column.id)}
                  />
                ))}
              </div>
              {/* inert: a preview row's buttons must never run — a native button would write to Notion. */}
              <div inert className="contents">
                {samples.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-faint">Chưa đọc được item mẫu từ Notion.</p>
                )}
                {samples.map((sample, index) => (
                  <GalleryTableRow
                    key={sample.page.id}
                    page={sample.page}
                    title={sample.title}
                    icon={sample.icon}
                    href={null}
                    cells={cells}
                    cover={
                      thumb
                        ? {
                            ratio: thumb.ratio,
                            round,
                            key: `p${sample.page.id}`,
                            hasSource: undefined,
                            posX: 50,
                            posY: 50,
                          }
                        : null
                    }
                    thumb={thumb ? { ...thumb, round, inTitle: layout.cover.placement === "title" } : null}
                    rowNumber={layout.rowNumbers ? index + 1 : null}
                    numberSticky={stickyCount > 0}
                    galleryId={galleryId}
                    viewId={viewId}
                    context={{ galleryId, pageId: sample.page.id, surface: "card" }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 2 · Properties not in the table */}
        <Tray items={tray} active={drop?.kind === "tray" && dragging !== null} onAdd={(id) => placeColumn(id, layout.columns.length)} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 3 · The selected column */}
          <ColumnPanel
            key={selectedColumn.id}
            column={selectedColumn}
            label={labelOf(selectedColumn.id)}
            property={byId.get(selectedColumn.id) ?? null}
            sharedName={names[selectedColumn.id] ?? ""}
            onSharedName={(name) => setNames((current) => ({ ...current, [selectedColumn.id]: name }))}
            tableWrap={layout.wrap}
            isFirst={selectedIndex === 0}
            isLast={selectedIndex === layout.columns.length - 1}
            onPatch={(patch) => patchColumn(selectedColumn.id, patch)}
            onMove={(by) => nudgeColumn(selectedColumn.id, by)}
            onHide={() => hideColumn(selectedColumn.id)}
          />

          <div className="flex flex-col gap-5">
            {/* 4 · The picture */}
            <CoverPanel
              cover={layout.cover}
              coverSource={coverSource}
              imageProperties={imageProperties}
              onPlacement={setPlacement}
              onShape={(shape) => setLayout((current) => ({ ...current, cover: { ...current.cover, shape } }))}
              onSize={(size) => setLayout((current) => ({ ...current, cover: { ...current.cover, size } }))}
              onSource={setCoverSource}
            />
            {/* 5 · The whole table */}
            <TablePanel layout={layout} onChange={(patch) => setLayout((current) => ({ ...current, ...patch }))} />
          </div>
        </div>

        <div className="sticky bottom-0 z-20 -mx-1 flex items-center gap-3 rounded-2xl bg-surface/90 px-1 py-3 backdrop-blur">
          <button type="button" onClick={save} disabled={saving || !dirty} className="btn btn-primary">
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const saved = JSON.parse(savedSignature) as { layout: TableLayout; coverSource: string };
                setLayout(saved.layout);
                setCoverSource(saved.coverSource);
              }}
              className="btn btn-ghost"
            >
              Bỏ thay đổi
            </button>
          )}
          {justSaved && !saving && (
            <span role="status" className="text-xs text-brand-ink">
              Đã lưu
            </span>
          )}
          {dirty && !saving && <span className="text-xs text-muted">Có thay đổi chưa lưu</span>}
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-pop ring-1 ring-brand">
            <Icon name="grip" className="size-3.5 text-faint" />
            {labelOf(dragging)}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/* ── Header cell: draggable, a drop target, and a selector ────────────────── */

function HeaderSlot({
  id,
  index,
  label,
  align,
  left,
  selected,
  dropSide,
  onSelect,
}: {
  id: string;
  index: number;
  label: string;
  align: ColumnAlign;
  left: string | null;
  selected: boolean;
  dropSide: "left" | "right" | null;
  onSelect: () => void;
}) {
  const draggable = useDraggable({ id: dragId("col", id) });
  const droppable = useDroppable({ id: `slot:${index}` });
  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      {...draggable.attributes}
      role="columnheader"
      data-align={align}
      aria-selected={selected}
      className={`g-th cursor-grab touch-none select-none${left ? " g-sticky" : ""} ${
        selected ? "!bg-brand-soft !text-brand-ink" : "hover:text-ink"
      } ${draggable.isDragging ? "opacity-40" : ""}`}
      style={left ? { left } : undefined}
      {...draggable.listeners}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <Icon name="grip" className="size-3.5 shrink-0 text-faint" />
        <span className="truncate">{label}</span>
      </span>
      {dropSide && (
        <span
          aria-hidden
          className={`absolute inset-y-1 z-20 w-1 rounded-full bg-brand ${dropSide === "left" ? "-left-0.5" : "-right-0.5"}`}
        />
      )}
    </div>
  );
}

/* ── Tray of hidden properties ─────────────────────────────────────────────── */

function Tray({
  items,
  active,
  onAdd,
}: {
  items: { id: string; label: string; hint: string; button?: boolean }[];
  active: boolean;
  onAdd: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: "tray" });
  const values = items.filter((item) => !item.button);
  const buttons = items.filter((item) => item.button);
  return (
    <section
      ref={setNodeRef}
      className={`rounded-3xl border border-dashed p-4 transition-colors ${
        active ? "border-brand bg-brand-soft" : "border-line-strong bg-subtle/60"
      }`}
    >
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Chưa có trong bảng</h2>
        <p className="text-xs text-muted">Kéo lên tiêu đề bảng để thêm cột · bấm để thêm vào cuối · thả cột vào đây để ẩn</p>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-faint">Mọi property đang quản lý đều đã có cột.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {values.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {values.map((item) => (
                <TrayChip key={item.id} item={item} onAdd={() => onAdd(item.id)} />
              ))}
            </div>
          )}
          {buttons.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium tracking-wide text-faint uppercase">Nút</span>
              {buttons.map((item) => (
                <TrayChip key={item.id} item={item} onAdd={() => onAdd(item.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TrayChip({ item, onAdd }: { item: { id: string; label: string; hint: string }; onAdd: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: dragId("tray", item.id) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={`${item.hint} — kéo vào bảng, hoặc bấm để thêm vào cuối`}
      onClick={onAdd}
      className={`chip cursor-grab touch-none ${isDragging ? "opacity-40" : ""}`}
      {...listeners}
      {...attributes}
    >
      {item.id === COVER_COLUMN_ID ? <Icon name="image" className="size-3.5" /> : <Icon name="plus" className="size-3.5" />}
      {item.label}
    </button>
  );
}

/* ── The selected column ───────────────────────────────────────────────────── */

function ColumnPanel({
  column,
  label,
  property,
  sharedName,
  onSharedName,
  tableWrap,
  isFirst,
  isLast,
  onPatch,
  onMove,
  onHide,
}: {
  column: TableColumn;
  label: string;
  property: EditorProperty | null;
  sharedName: string;
  onSharedName: (name: string) => void;
  tableWrap: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<TableColumn>) => void;
  onMove: (by: -1 | 1) => void;
  onHide: () => void;
}) {
  const isTitle = column.id === TITLE_FIELD_ID;
  const isCover = column.id === COVER_COLUMN_ID;
  return (
    <section className="panel flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">Cột đang chọn</p>
          <h2 className="display truncate text-lg text-ink">{column.label || label}</h2>
          <p className="truncate font-mono text-[11px] text-faint">
            {isTitle ? "Tiêu đề · luôn có trong bảng" : isCover ? "Ảnh · chỉnh ở khung Ảnh" : property?.typeLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="Sang trái" title="Sang trái" disabled={isFirst} onClick={() => onMove(-1)} className="btn btn-ghost btn-sm btn-icon">
            <Icon name="chevron-left" />
          </button>
          <button type="button" aria-label="Sang phải" title="Sang phải" disabled={isLast} onClick={() => onMove(1)} className="btn btn-ghost btn-sm btn-icon">
            <Icon name="chevron-right" />
          </button>
          {!isTitle && (
            <button type="button" onClick={onHide} className="btn btn-secondary btn-sm">
              Ẩn cột
            </button>
          )}
        </div>
      </div>

      {!isCover && (
        <>
          {property && (
            <Field label="Tên hiển thị">
              <input
                type="text"
                value={sharedName}
                placeholder={property.notionPropertyName}
                maxLength={120}
                onChange={(event) => onSharedName(event.target.value)}
                className="input input-sm"
              />
              <span className="field-hint">
                Tên của property trong Hallery — dùng ở mọi view, bộ lọc, sắp xếp, Card Detail và form. Tên trong Notion
                giữ nguyên. Để trống để dùng tên gốc.
              </span>
            </Field>
          )}

          <Field label="Tên cột trong bảng">
            <input
              type="text"
              value={column.label ?? ""}
              placeholder={label}
              maxLength={80}
              onChange={(event) => onPatch({ label: event.target.value || undefined })}
              className="input input-sm"
            />
            <span className="field-hint">Chỉ cho bảng này. Để trống để dùng tên hiển thị.</span>
          </Field>

          <Field label={`Độ rộng · ${column.width}px`}>
            <input
              type="range"
              min={MIN_COLUMN_WIDTH}
              max={MAX_COLUMN_WIDTH}
              step={10}
              value={column.width}
              onChange={(event) => onPatch({ width: Number(event.target.value) })}
              className="w-full accent-brand"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Căn lề">
              <Segmented<ColumnAlign>
                value={column.align ?? "left"}
                options={[
                  { value: "left", label: "Trái" },
                  { value: "center", label: "Giữa" },
                  { value: "right", label: "Phải" },
                ]}
                onChange={(align) => onPatch({ align: align === "left" ? undefined : align })}
              />
            </Field>
            <Field label="Nội dung dài">
              <Segmented<"table" | "wrap" | "clip">
                value={column.wrap ?? "table"}
                options={[
                  { value: "table", label: `Theo bảng` },
                  { value: "wrap", label: "Ngắt dòng" },
                  { value: "clip", label: "Một dòng" },
                ]}
                onChange={(wrap) => onPatch({ wrap: wrap === "table" ? undefined : wrap })}
              />
              <span className="field-hint">Bảng đang: {tableWrap ? "ngắt dòng" : "một dòng"}.</span>
            </Field>
          </div>
        </>
      )}

      {property && <FormatEditor property={property} display={column.display} onChange={(display) => onPatch({ display })} />}
    </section>
  );
}

/** This table's own display style for a property, or the shared one the card editor sets. */
function FormatEditor({
  property,
  display,
  onChange,
}: {
  property: EditorProperty;
  display: DisplayConfig | undefined;
  onChange: (display: DisplayConfig | undefined) => void;
}) {
  const shared = parseDisplayConfig(property.displayConfig);
  const kinds = KIND_OPTIONS[property.configType] ?? [];
  const own = display !== undefined;
  const config = display ?? shared;
  const affix = allowsAffix(property.configType, config.kind);
  if (kinds.length === 0 && !affix) {
    return (
      <Field label="Cách hiển thị">
        <p className="text-xs text-faint">Kiểu này hiển thị theo mặc định — không có tuỳ chỉnh định dạng riêng.</p>
      </Field>
    );
  }
  const patch = (next: Partial<DisplayConfig>) => onChange({ ...config, ...next });
  const pick = ({ kind, max, prefix, suffix, label }: DisplayConfig): DisplayConfig =>
    Object.fromEntries(Object.entries({ kind, max, prefix, suffix, label }).filter(([, value]) => value !== undefined));

  return (
    <Field label="Cách hiển thị">
      <Segmented<"shared" | "own">
        value={own ? "own" : "shared"}
        options={[
          { value: "shared", label: "Theo định dạng chung" },
          { value: "own", label: "Riêng cho bảng" },
        ]}
        onChange={(mode) => onChange(mode === "own" ? pick(shared) : undefined)}
      />
      <div className={`mt-3 flex flex-col gap-3 ${own ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!own}>
        {kinds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!own}
                aria-pressed={(config.kind ?? kinds[0].value) === option.value}
                onClick={() => patch({ kind: option.value })}
                className="chip aria-pressed:bg-brand-soft aria-pressed:text-brand-ink aria-pressed:ring-brand-line"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {config.kind === "rate" && (
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            Số sao tối đa
            <input
              type="number"
              min={1}
              max={10}
              disabled={!own}
              value={config.max ?? 5}
              onChange={(event) => patch({ max: Number(event.target.value) || 5 })}
              className="input input-sm w-20"
            />
          </label>
        )}
        {config.kind === "button" && (
          <input
            type="text"
            disabled={!own}
            value={config.label ?? ""}
            placeholder="Chữ trên nút"
            onChange={(event) => patch({ label: event.target.value })}
            className="input input-sm"
          />
        )}
        {affix && (
          <div className="flex gap-2">
            <input
              type="text"
              disabled={!own}
              value={config.prefix ?? ""}
              placeholder="Chữ trước"
              onChange={(event) => patch({ prefix: event.target.value })}
              className="input input-sm"
            />
            <input
              type="text"
              disabled={!own}
              value={config.suffix ?? ""}
              placeholder="Chữ sau"
              onChange={(event) => patch({ suffix: event.target.value })}
              className="input input-sm"
            />
          </div>
        )}
      </div>
      <span className="field-hint">
        {own ? "Chỉ đổi trong bảng này — card và Card Detail giữ định dạng của chúng." : "Đang dùng định dạng chung của property — chỉnh ở Bố cục card của một view Gallery."}
      </span>
    </Field>
  );
}

/* ── The picture ───────────────────────────────────────────────────────────── */

function CoverPanel({
  cover,
  coverSource,
  imageProperties,
  onPlacement,
  onShape,
  onSize,
  onSource,
}: {
  cover: TableLayout["cover"];
  coverSource: string;
  imageProperties: string[];
  onPlacement: (placement: CoverPlacement) => void;
  onShape: (shape: ThumbShape) => void;
  onSize: (size: ThumbSize) => void;
  onSource: (source: string) => void;
}) {
  const off = cover.placement === "none";
  return (
    <section className="panel flex flex-col gap-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon name="image" className="size-4 text-muted" />
        Ảnh
      </h2>
      <Field label="Vị trí">
        <Segmented<CoverPlacement>
          value={cover.placement}
          options={[
            { value: "none", label: "Không hiện" },
            { value: "title", label: "Trong ô tiêu đề" },
            { value: "column", label: "Cột riêng" },
          ]}
          onChange={onPlacement}
        />
      </Field>
      <div className={`flex flex-col gap-4 ${off ? "pointer-events-none opacity-50" : ""}`} aria-disabled={off}>
        <Field label="Hình">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "square", label: "Vuông" },
                { value: "circle", label: "Tròn" },
                { value: "landscape", label: "Ngang" },
                { value: "portrait", label: "Dọc" },
              ] as const
            ).map((option) => {
              const box = thumbBox({ shape: option.value, size: "sm" });
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={off}
                  aria-pressed={cover.shape === option.value}
                  onClick={() => onShape(option.value)}
                  className="flex w-16 flex-col items-center gap-1.5 rounded-xl border border-line-strong bg-surface py-2 text-[11px] text-ink-soft hover:border-faint aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-ink"
                >
                  <span className="flex h-7 items-center">
                    <span
                      className={`block bg-current/30 ${option.value === "circle" ? "rounded-full" : "rounded-[3px]"}`}
                      style={{ width: box.width, height: box.height }}
                    />
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Cỡ">
          <Segmented<ThumbSize>
            value={cover.size}
            options={[
              { value: "sm", label: "Nhỏ" },
              { value: "md", label: "Vừa" },
              { value: "lg", label: "Lớn" },
            ]}
            onChange={onSize}
          />
        </Field>
        <Field label="Lấy ảnh từ">
          <select value={coverSource} disabled={off} onChange={(event) => onSource(event.target.value)} className="input input-sm">
            <option value={PAGE_COVER}>Ảnh bìa của page</option>
            {imageProperties.map((name) => (
              <option key={name} value={`${PROPERTY_PREFIX}${name}`}>
                Prop: {name}
              </option>
            ))}
            {coverSource.startsWith(PROPERTY_PREFIX) && !imageProperties.includes(coverSource.slice(PROPERTY_PREFIX.length)) && (
              <option value={coverSource}>Prop: {coverSource.slice(PROPERTY_PREFIX.length)}</option>
            )}
            <option value={CONTENT_IMAGE}>Ảnh trong nội dung page</option>
          </select>
          <span className="field-hint">Dùng chung với ảnh bìa card của view. Xem trước đổi nguồn sau khi Lưu.</span>
        </Field>
      </div>
    </section>
  );
}

/* ── The whole table ───────────────────────────────────────────────────────── */

function TablePanel({ layout, onChange }: { layout: TableLayout; onChange: (patch: Partial<TableLayout>) => void }) {
  return (
    <section className="panel flex flex-col gap-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon name="table" className="size-4 text-muted" />
        Cả bảng
      </h2>
      <Field label="Độ cao dòng">
        <Segmented<TableDensity>
          value={layout.density}
          options={[
            { value: "compact", label: "Gọn" },
            { value: "normal", label: "Vừa" },
            { value: "roomy", label: "Thoáng" },
          ]}
          onChange={(density) => onChange({ density })}
        />
      </Field>
      <Toggle
        checked={layout.wrap}
        onChange={(wrap) => onChange({ wrap })}
        label="Ngắt dòng nội dung dài"
        hint="Mặc định cho mọi cột; từng cột đổi được riêng. Tắt: mỗi item một hàng, phần dư cắt bằng “…”."
      />
      <Toggle
        checked={layout.stickyTitle}
        onChange={(stickyTitle) => onChange({ stickyTitle })}
        label="Cố định cột tiêu đề khi cuộn ngang"
        hint="Giữ đứng yên mọi cột từ trái sang tới cột tiêu đề."
      />
      <Toggle
        checked={layout.rowNumbers}
        onChange={(rowNumbers) => onChange({ rowNumbers })}
        label="Số thứ tự"
        hint="Đánh số theo thứ tự đang hiện — sau lọc, sắp xếp; mỗi nhóm đếm lại từ 1."
      />
      <Toggle
        checked={layout.stripes}
        onChange={(stripes) => onChange({ stripes })}
        label="Kẻ sọc xen kẽ"
        hint="Tô nhạt mỗi dòng thứ hai cho dễ dò theo hàng."
      />
    </section>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="segmented w-full">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className="flex-1 justify-center"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-brand" />
      <span>
        {label}
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}
