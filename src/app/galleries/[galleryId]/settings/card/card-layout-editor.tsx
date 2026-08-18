"use client";

import { useActionState, useMemo, useState } from "react";
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
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ARRANGEMENTS,
  MAX_COLS,
  MAX_OVERLAY_FIELDS,
  MAX_ROWS,
  TITLE_FIELD_ID,
  arrangementsFor,
  canMerge,
  makeGrid,
  maxRowsBesideCover,
  mergeBox,
  resizeGrid,
  spanOf,
  unmergeBox,
  type ArrangementId,
  type CardField,
  type CardLayout,
  type CardRatio,
  type CoverOrientation,
  type Grid,
  type GridBox,
  type MergeDirection,
} from "@/lib/card-layout";
import { CARD_RATIOS } from "@/lib/card-layout";
import { COVER_RATIOS } from "@/lib/notion-cover";
import type { DisplayConfig } from "@/lib/display-config";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";
import { ArrangementGlyph, GridGlyph, RatioGlyph } from "./glyphs";
import { PropertyPanel, type PanelProperty } from "./property-panel";

export type EditableCardProperty = PanelProperty;
export type CoverShape = { aspect: CoverOrientation; ratio: string };

const ORIENTATIONS: { value: CoverOrientation; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
];

export function CardLayoutEditor({
  galleryId,
  properties,
  initialShape,
  initialLayout,
  previewTitle,
  previewValues,
  previewCoverUrl,
}: {
  galleryId: string;
  properties: EditableCardProperty[];
  initialShape: CoverShape;
  initialLayout: CardLayout;
  previewTitle: string;
  previewValues: Record<string, string>;
  previewCoverUrl: string | null;
}) {
  const [layout, setLayout] = useState<CardLayout>(initialLayout);
  const [shape, setShape] = useState<CoverShape>(initialShape);
  const [configs, setConfigs] = useState<Record<string, DisplayConfig>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recordPreview, setRecordPreview] = useState(true);

  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, { error: null });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const spec = ARRANGEMENTS[layout.arrangement];
  const coverRatio = shape.ratio.replace(":", " / ");
  const byId = useMemo(() => new Map(properties.map((p) => [p.notionPropertyId, p])), [properties]);

  const placed = useMemo(() => {
    const ids = new Set<string>(layout.overlay.map((f) => f.id));
    const walk = (grid: Grid) => {
      for (const box of grid.boxes) {
        box.fields.forEach((f) => ids.add(f.id));
        if (box.grid) walk(box.grid);
      }
    };
    Object.values(layout.regions).forEach(walk);
    return ids;
  }, [layout]);

  const unplaced = [
    ...(placed.has(TITLE_FIELD_ID) ? [] : [{ id: TITLE_FIELD_ID, name: "Tiêu đề", type: "title" }]),
    ...properties
      .filter((p) => !placed.has(p.notionPropertyId))
      .map((p) => ({ id: p.notionPropertyId, name: p.notionPropertyName, type: p.notionPropertyType })),
  ].filter((entry) => entry.name.toLowerCase().includes(search.trim().toLowerCase()));

  /* ── mutations ─────────────────────────────────────────────────────────── */

  const mapGrids = (transform: (grid: Grid) => Grid) =>
    setLayout((current) => ({
      ...current,
      regions: Object.fromEntries(Object.entries(current.regions).map(([id, grid]) => [id, transform(grid)])),
    }));

  function removeEverywhere(current: CardLayout, id: string): CardLayout {
    const strip = (grid: Grid): Grid => ({
      ...grid,
      boxes: grid.boxes.map((box) => ({
        ...box,
        fields: box.fields.filter((f) => f.id !== id),
        ...(box.grid ? { grid: strip(box.grid) } : {}),
      })),
    });
    return {
      ...current,
      overlay: current.overlay.filter((f) => f.id !== id),
      regions: Object.fromEntries(Object.entries(current.regions).map(([key, grid]) => [key, strip(grid)])),
    };
  }

  function findField(current: CardLayout, id: string): CardField {
    const search = (grid: Grid): CardField | undefined => {
      for (const box of grid.boxes) {
        const hit = box.fields.find((f) => f.id === id);
        if (hit) return hit;
        if (box.grid) {
          const nested = search(box.grid);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    return (
      current.overlay.find((f) => f.id === id) ??
      Object.values(current.regions).map(search).find(Boolean) ?? { id, showLabel: id !== TITLE_FIELD_ID }
    );
  }

  /** Drops a field into a box, or into the overlay, undoing a merge if it landed on one. */
  function place(id: string, target: string, beforeId?: string) {
    setLayout((current) => {
      const field = findField(current, id);
      const next = removeEverywhere(current, id);

      if (target === "tray") return next;
      if (target === "overlay") {
        if (next.overlay.length >= MAX_OVERLAY_FIELDS) return current;
        const fields = [...next.overlay];
        insert(fields, field, beforeId);
        return { ...next, overlay: fields };
      }

      const drop = (grid: Grid): Grid => ({
        ...grid,
        boxes: grid.boxes.map((box) => {
          if (box.id === target && !box.grid) {
            const fields = [...box.fields];
            insert(fields, field, beforeId);
            // Dropping into a folded box is the clearest way to say "give it back".
            const rest = { ...box, fields };
            delete rest.mergedInto;
            return rest;
          }
          return box.grid ? { ...box, grid: drop(box.grid) } : box;
        }),
      });

      return {
        ...next,
        regions: Object.fromEntries(Object.entries(next.regions).map(([key, grid]) => [key, drop(grid)])),
      };
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const id = String(active.id).replace("field:", "");
    const target = String(over.id);
    if (target.startsWith("box:")) place(id, target.slice(4));
    else if (target === "zone:overlay") place(id, "overlay");
    else if (target === "zone:tray") place(id, "tray");
    else if (target.startsWith("before:")) place(id, findBoxOf(layout, target.slice(7)) ?? "tray", target.slice(7));
  }

  const setShowLabel = (id: string, showLabel: boolean) =>
    setLayout((current) => {
      const flip = (fields: CardField[]) => fields.map((f) => (f.id === id ? { ...f, showLabel } : f));
      const walk = (grid: Grid): Grid => ({
        ...grid,
        boxes: grid.boxes.map((box) => ({
          ...box,
          fields: flip(box.fields),
          ...(box.grid ? { grid: walk(box.grid) } : {}),
        })),
      });
      return {
        ...current,
        overlay: flip(current.overlay),
        regions: Object.fromEntries(Object.entries(current.regions).map(([k, g]) => [k, walk(g)])),
      };
    });

  /**
   * A landscape cover cannot sit beside its text, so switching shape has to pull the
   * arrangement back to one that shape actually offers.
   */
  const changeShape = (next: CoverShape) => {
    setShape(next);
    const allowed = arrangementsFor(next.aspect);
    if (!allowed.includes(layout.arrangement)) setArrangement(allowed[0]);
  };

  const setArrangement = (arrangement: ArrangementId) =>
    setLayout((current) => {
      const nextRegions = ARRANGEMENTS[arrangement].regions;
      const carried = Object.values(current.regions);
      const regions: Record<string, Grid> = {};
      nextRegions.forEach((id, index) => {
        regions[id] = carried[index] ?? makeGrid(1, 1);
      });
      // Frames that disappear hand their fields to the last surviving one.
      if (carried.length > nextRegions.length && nextRegions.length > 0) {
        const last = nextRegions[nextRegions.length - 1];
        const extra = carried.slice(nextRegions.length).flatMap((grid) => grid.boxes.flatMap((b) => b.fields));
        const boxes = [...regions[last].boxes];
        boxes[boxes.length - 1] = {
          ...boxes[boxes.length - 1],
          fields: [...boxes[boxes.length - 1].fields, ...extra],
        };
        regions[last] = { ...regions[last], boxes };
      }
      return { ...current, arrangement, regions };
    });

  const resizeRegion = (regionId: string, cols: 1 | 2, rows: number) =>
    setLayout((current) => ({
      ...current,
      regions: { ...current.regions, [regionId]: resizeGrid(current.regions[regionId], cols, rows) },
    }));

  const setBoxGrid = (boxId: string, cols: 1 | 2, rows: number) =>
    mapGrids((grid) => ({
      ...grid,
      boxes: grid.boxes.map((box) => {
        if (box.id !== boxId) return box;
        if (cols === 1 && rows === 1) {
          // Collapsing layer 2 hands the properties back to the frame itself.
          const { grid: nested, ...rest } = box;
          return nested ? { ...rest, fields: nested.boxes.flatMap((b) => b.fields) } : box;
        }
        const carried = box.grid ? box.grid.boxes.map((b) => b.fields) : [box.fields];
        return { ...box, fields: [], grid: makeGrid(cols, rows, carried) };
      }),
    }));

  const applyMerge = (boxId: string, direction: MergeDirection) =>
    mapGrids((grid) => walkGrid(grid, (g) => mergeBox(g, boxId, direction)));
  const applyUnmerge = (boxId: string) => mapGrids((grid) => walkGrid(grid, (g) => unmergeBox(g, boxId)));

  const rowCap = spec.sideBySide ? maxRowsBesideCover(shape.aspect, layout.ratio, shape.ratio) : MAX_ROWS;
  const selectedProperty = selected && selected !== TITLE_FIELD_ID ? (byId.get(selected) ?? null) : null;
  const selectedField = selected ? findField(layout, selected) : null;
  const draggingLabel =
    dragging === TITLE_FIELD_ID ? "Tiêu đề" : dragging ? byId.get(dragging)?.notionPropertyName : null;

  return (
    <form action={formAction} className="flex h-[calc(100vh-11rem)] min-h-[34rem] gap-4">
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <input type="hidden" name="coverAspect" value={shape.aspect} />
      <input type="hidden" name="coverRatio" value={shape.ratio} />
      <input type="hidden" name="propertyConfigs" value={JSON.stringify(configs)} />

      <DndContext
        id="card-layout"
        sensors={sensors}
        onDragStart={({ active }: DragStartEvent) => setDragging(String(active.id).replace("field:", ""))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {/* 1 + 2 + 3 */}
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <div className="flex gap-3">
            <CoverShapeButton shape={shape} onChange={changeShape} />
            <ArrangementButton
              value={layout.arrangement}
              orientation={shape.aspect}
              onChange={setArrangement}
            />
          </div>
          <PropertyList
            entries={unplaced}
            search={search}
            onSearch={setSearch}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {/* 4 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
            <div className="flex flex-1 items-center justify-center overflow-auto p-6">
              <CardCanvas
                layout={layout}
                coverRatio={coverRatio}
                coverUrl={previewCoverUrl}
                title={previewTitle}
                byId={byId}
                values={recordPreview ? previewValues : {}}
                configs={configs}
                selected={selected}
                onSelect={setSelected}
                onRemove={(id) => place(id, "tray")}
                onBoxGrid={setBoxGrid}
                onMerge={applyMerge}
                onUnmerge={applyUnmerge}
                rowCap={rowCap}
                onResizeRegion={resizeRegion}
                onRatio={(ratio) => setLayout((c) => ({ ...c, ratio }))}
              />
            </div>
            <label className="flex items-center gap-2 border-t border-stone-200 bg-white px-4 py-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={recordPreview}
                onChange={(event) => setRecordPreview(event.target.checked)}
              />
              Xem bằng dữ liệu thật của item đầu tiên
            </label>
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : "Lưu bố cục"}
          </button>
        </div>

        {/* 5 */}
        <div className="w-72 shrink-0">
          <PropertyPanel
            key={selected ?? "none"}
            property={selectedProperty}
            isTitle={selected === TITLE_FIELD_ID}
            showLabel={selectedField?.showLabel ?? true}
            onToggleLabel={() => selected && setShowLabel(selected, !(selectedField?.showLabel ?? true))}
            onChange={(propertyId, config) => setConfigs((c) => ({ ...c, [propertyId]: config }))}
          />
        </div>

        <DragOverlay>
          {draggingLabel && (
            <span className="rounded-md border border-emerald-600 bg-white px-2.5 py-1 text-sm shadow-lg">
              {draggingLabel}
            </span>
          )}
        </DragOverlay>
      </DndContext>
    </form>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function insert(fields: CardField[], field: CardField, beforeId?: string) {
  const at = beforeId ? fields.findIndex((f) => f.id === beforeId) : -1;
  if (at === -1) fields.push(field);
  else fields.splice(at, 0, field);
}

function findBoxOf(layout: CardLayout, fieldId: string): string | null {
  const search = (grid: Grid): string | null => {
    for (const box of grid.boxes) {
      if (box.fields.some((f) => f.id === fieldId)) return box.id;
      if (box.grid) {
        const nested = search(box.grid);
        if (nested) return nested;
      }
    }
    return null;
  };
  if (layout.overlay.some((f) => f.id === fieldId)) return "overlay";
  for (const grid of Object.values(layout.regions)) {
    const hit = search(grid);
    if (hit) return hit;
  }
  return null;
}

/** Applies a transform to whichever grid contains the box being changed. */
function walkGrid(grid: Grid, transform: (grid: Grid) => Grid): Grid {
  const applied = transform(grid);
  return {
    ...applied,
    boxes: applied.boxes.map((box) => (box.grid ? { ...box, grid: walkGrid(box.grid, transform) } : box)),
  };
}

/* ── 1: cover shape ──────────────────────────────────────────────────────── */

function CoverShapeButton({ shape, onChange }: { shape: CoverShape; onChange: (value: CoverShape) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-24 w-28 flex-col items-center justify-center gap-1 rounded-lg border bg-white p-2 ${
          open ? "border-emerald-700" : "border-stone-300 hover:border-stone-500"
        }`}
      >
        <RatioGlyph ratio={shape.ratio} selected />
        <span className="font-mono text-[11px] text-stone-600">{shape.ratio}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chiều ảnh"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border border-stone-300 bg-white p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Chiều ảnh</p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone-400 hover:text-stone-700">
              Đóng
            </button>
          </div>
          <div className="mb-3 flex gap-1">
            {ORIENTATIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={shape.aspect === option.value}
                onClick={() => onChange({ aspect: option.value, ratio: COVER_RATIOS[option.value][0] })}
                className={`flex-1 rounded border px-2 py-1 text-xs ${
                  shape.aspect === option.value
                    ? "border-emerald-700 bg-emerald-50 font-medium text-emerald-800"
                    : "border-stone-300 text-stone-600 hover:border-stone-500"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {COVER_RATIOS[shape.aspect].map((ratio) => {
              const selected = shape.ratio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange({ ...shape, ratio });
                    setOpen(false);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-md border p-2 ${
                    selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                  }`}
                >
                  <RatioGlyph ratio={ratio} selected={selected} />
                  <span className="font-mono text-[11px] text-stone-700">{ratio}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 2: layer 1 ──────────────────────────────────────────────────────────── */

function ArrangementButton({
  value,
  orientation,
  onChange,
}: {
  value: ArrangementId;
  orientation: CoverOrientation;
  onChange: (value: ArrangementId) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = arrangementsFor(orientation);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-24 w-28 flex-col items-center justify-center gap-1 rounded-lg border bg-white p-2 ${
          open ? "border-emerald-700" : "border-stone-300 hover:border-stone-500"
        }`}
      >
        <ArrangementGlyph id={value} selected />
        <span className="text-center text-[10px] leading-tight text-stone-600">
          {ARRANGEMENTS[value].label}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Bố cục ảnh"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border border-stone-300 bg-white p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Ảnh nằm ở đâu</p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone-400 hover:text-stone-700">
              Đóng
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {options.map((id) => {
              const selected = id === value;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={`rounded-md border p-2 text-left ${
                    selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                  }`}
                >
                  <ArrangementGlyph id={id} selected={selected} />
                  <span className="mt-1.5 block text-[11px] leading-tight text-stone-700">
                    {ARRANGEMENTS[id].label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 3: property list ────────────────────────────────────────────────────── */

function PropertyList({
  entries,
  search,
  onSearch,
  selected,
  onSelect,
}: {
  entries: { id: string; name: string; type: string }[];
  search: string;
  onSearch: (value: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "zone:tray" });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-1 flex-col rounded-lg border bg-white p-2 ${
        isOver ? "border-emerald-500 bg-emerald-50" : "border-stone-200"
      }`}
    >
      <div className="relative mb-2">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Tìm property"
          className="w-full rounded-md border border-stone-300 py-1.5 pl-2 pr-7 text-xs outline-none focus:border-emerald-600"
        />
        <span aria-hidden className="pointer-events-none absolute right-2 top-1.5 text-stone-400">
          ⌕
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-stone-400">Không còn property nào.</p>
        ) : (
          entries.map((entry) => (
            <TrayChip
              key={entry.id}
              id={entry.id}
              name={entry.name}
              type={entry.type}
              selected={selected === entry.id}
              onSelect={() => onSelect(entry.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TrayChip({
  id,
  name,
  type,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  type: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${id}` });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onSelect}
      className={`flex w-full cursor-grab items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs active:cursor-grabbing ${
        selected ? "border-emerald-600 bg-emerald-50" : "border-stone-200 hover:border-stone-400"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="text-stone-400">⠿</span>
      <span className={`min-w-0 flex-1 truncate ${id === TITLE_FIELD_ID ? "font-semibold" : ""}`}>{name}</span>
      <span className="shrink-0 font-mono text-[10px] text-stone-400">{type}</span>
    </button>
  );
}

/* ── 4: canvas ───────────────────────────────────────────────────────────── */

type CanvasProps = {
  layout: CardLayout;
  coverRatio: string;
  coverUrl: string | null;
  title: string;
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
  configs: Record<string, DisplayConfig>;
  selected: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onBoxGrid: (boxId: string, cols: 1 | 2, rows: number) => void;
  onMerge: (boxId: string, direction: MergeDirection) => void;
  onUnmerge: (boxId: string) => void;
  rowCap: number;
  onResizeRegion: (regionId: string, cols: 1 | 2, rows: number) => void;
  onRatio: (ratio: CardRatio) => void;
};

function CardCanvas(props: CanvasProps) {
  const { layout, coverRatio, coverUrl, rowCap, onResizeRegion, onRatio } = props;
  const spec = ARRANGEMENTS[layout.arrangement];
  const wide: boolean = spec.sideBySide;
  const regions: string[] = [...spec.regions];

  const cover = (
    <div
      className="relative shrink-0 overflow-hidden rounded bg-stone-200 bg-cover bg-center"
      style={{
        aspectRatio: coverRatio,
        width: wide ? `${layout.ratio[0]}%` : "100%",
        ...(coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : {}),
      }}
    >
      <OverlayZone {...props} />
    </div>
  );

  return (
    <div className="w-full" style={{ maxWidth: wide ? 620 : 380 }}>
      <div className="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm">
        {wide ? (
          <>
            <div className="flex">
              {cover}
              <div className="min-w-0 flex-1 p-2">
                <RegionBlock {...props} regionId="main" />
              </div>
            </div>
            {regions.includes("below") && (
              <div className="p-2 pt-0">
                <RegionBlock {...props} regionId="below" />
              </div>
            )}
          </>
        ) : (
          <>
            {cover}
            {regions.map((regionId) => (
              <div key={regionId} className="p-2">
                <RegionBlock {...props} regionId={regionId} />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        {regions.map((regionId) => (
          <GridSizePicker
            key={regionId}
            label={regions.length > 1 ? (regionId === "main" ? "Ô cạnh ảnh" : "Ô dưới") : "Khung nội dung"}
            grid={layout.regions[regionId]}
            maxRows={regionId === "main" ? rowCap : MAX_ROWS}
            onChange={(cols, rows) => onResizeRegion(regionId, cols, rows)}
          />
        ))}
        {wide && <CardRatioPicker value={layout.ratio} onChange={onRatio} />}
      </div>
      {wide && (
        <p className="mt-2 text-center text-[11px] text-stone-400">
          Tối đa {rowCap} dòng cạnh ảnh để chữ không cao hơn ảnh.
        </p>
      )}
    </div>
  );
}

function RegionBlock({ regionId, ...props }: CanvasProps & { regionId: string }) {
  const grid = props.layout.regions[regionId];
  if (!grid) return null;
  return <GridBlock {...props} grid={grid} depth={0} />;
}

function GridBlock({ grid, depth, ...props }: CanvasProps & { grid: Grid; depth: number }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
    >
      {grid.boxes.map((box, index) => {
        if (box.mergedInto) return null;
        const { colSpan, rowSpan } = spanOf(grid, index);
        return (
          <BoxSlot
            key={box.id}
            {...props}
            grid={grid}
            box={box}
            index={index}
            depth={depth}
            colSpan={colSpan}
            rowSpan={rowSpan}
          />
        );
      })}
    </div>
  );
}

function BoxSlot({
  grid,
  box,
  index,
  depth,
  colSpan,
  rowSpan,
  ...props
}: CanvasProps & {
  grid: Grid;
  box: GridBox;
  index: number;
  depth: number;
  colSpan: number;
  rowSpan: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${box.id}` });
  const [menuOpen, setMenuOpen] = useState(false);

  const empty = box.fields.length === 0 && !box.grid;
  const mergeLeft = canMerge(grid, box.id, "left");
  const mergeUp = canMerge(grid, box.id, "up");
  const absorbed = grid.boxes.some(
    (other, at) =>
      other.mergedInto &&
      ((other.mergedInto === "left" && at === index + 1) ||
        (other.mergedInto === "up" && at === index + grid.cols)),
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        gridColumn: colSpan > 1 ? `span ${colSpan}` : undefined,
        gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
      }}
      className={`relative min-h-10 rounded border border-dashed p-1 ${
        isOver ? "border-emerald-500 bg-emerald-50" : absorbed ? "border-stone-200 bg-stone-50/70" : "border-stone-300"
      }`}
    >
      {box.grid ? (
        <GridBlock {...props} grid={box.grid} depth={depth + 1} />
      ) : (
        <>
          {box.fields.length === 0 && (
            <span className="block px-1 py-1 text-[10px] text-stone-400">Kéo prop vào</span>
          )}
          <div className="flex flex-col gap-1">
            {box.fields.map((field) => (
              <FieldChip
                key={field.id}
                field={field}
                property={props.byId.get(field.id) ?? null}
                title={props.title}
                value={props.values[field.id]}
                config={props.configs[field.id]}
                selected={props.selected === field.id}
                onSelect={() => props.onSelect(field.id)}
                onRemove={() => props.onRemove(field.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Layer 2 and merge controls, only where they make sense. */}
      <div className="absolute right-0.5 top-0.5 z-20 flex gap-0.5">
        {depth === 0 && !box.mergedInto && (
          <MiniButton label="Chia ô" onClick={() => setMenuOpen((o) => !o)}>
            <GridGlyph cols={box.grid?.cols ?? 1} rows={box.grid?.rows ?? 1} selected={menuOpen} />
          </MiniButton>
        )}
        {empty && (mergeLeft || mergeUp) && (
          <MiniButton label="Gộp ô" onClick={() => setMenuOpen((o) => !o)}>
            <span className="px-1 text-[10px] text-stone-500">⇱</span>
          </MiniButton>
        )}
      </div>

      {menuOpen && (
        <div className="absolute right-0 top-6 z-30 w-44 rounded-lg border border-stone-300 bg-white p-2 shadow-lg">
          {depth === 0 && (
            <>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">Chia ô</p>
              <div className="mb-2 grid grid-cols-4 gap-1">
                {([1, 2] as const).flatMap((cols) =>
                  [1, 2].map((rows) => (
                    <button
                      key={`${cols}x${rows}`}
                      type="button"
                      onClick={() => {
                        props.onBoxGrid(box.id, cols, rows);
                        setMenuOpen(false);
                      }}
                      className="flex flex-col items-center gap-0.5 rounded border border-stone-300 p-1 hover:border-emerald-600"
                    >
                      <GridGlyph cols={cols} rows={rows} selected={false} />
                      <span className="text-[9px] text-stone-500">
                        {cols}×{rows}
                      </span>
                    </button>
                  )),
                )}
              </div>
            </>
          )}
          {empty && (mergeLeft || mergeUp) && (
            <>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">Gộp ô</p>
              <div className="flex gap-1">
                {mergeLeft && (
                  <MenuAction
                    onClick={() => {
                      props.onMerge(box.id, "left");
                      setMenuOpen(false);
                    }}
                  >
                    Gộp ngang
                  </MenuAction>
                )}
                {mergeUp && (
                  <MenuAction
                    onClick={() => {
                      props.onMerge(box.id, "up");
                      setMenuOpen(false);
                    }}
                  >
                    Gộp dọc
                  </MenuAction>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* A folded neighbour can be handed back. */}
      {absorbed && (
        <button
          type="button"
          onClick={() => {
            const folded = grid.boxes.find(
              (other, at) =>
                other.mergedInto &&
                ((other.mergedInto === "left" && at === index + 1) ||
                  (other.mergedInto === "up" && at === index + grid.cols)),
            );
            if (folded) props.onUnmerge(folded.id);
          }}
          className="absolute bottom-0.5 right-0.5 z-20 rounded border border-stone-300 bg-white px-1 text-[9px] text-stone-500 hover:border-stone-500"
        >
          bỏ gộp
        </button>
      )}
    </div>
  );
}

function MiniButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded border border-stone-300 bg-white p-0.5 hover:border-stone-500"
    >
      {children}
    </button>
  );
}

function MenuAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded border border-stone-300 px-1.5 py-1 text-[10px] text-stone-600 hover:border-emerald-600 hover:text-emerald-800"
    >
      {children}
    </button>
  );
}

function OverlayZone(props: CanvasProps) {
  const { setNodeRef, isOver } = useDroppable({ id: "zone:overlay" });
  const { layout } = props;

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-1.5 ${
        isOver ? "ring-1 ring-emerald-400" : ""
      }`}
    >
      {layout.overlay.length === 0 ? (
        <span className="text-[10px] text-white/70">Đè lên ảnh · tối đa {MAX_OVERLAY_FIELDS}</span>
      ) : (
        layout.overlay.map((field) => (
          <FieldChip
            key={field.id}
            field={field}
            property={props.byId.get(field.id) ?? null}
            title={props.title}
            value={props.values[field.id]}
            config={props.configs[field.id]}
            selected={props.selected === field.id}
            onSelect={() => props.onSelect(field.id)}
            onRemove={() => props.onRemove(field.id)}
            dark
          />
        ))
      )}
    </div>
  );
}

function FieldChip({
  field,
  property,
  title,
  value,
  config,
  selected,
  onSelect,
  onRemove,
  dark,
}: {
  field: CardField;
  property: EditableCardProperty | null;
  title: string;
  value?: string;
  config?: DisplayConfig;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  dark?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${field.id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `before:${field.id}` });

  const isTitle = field.id === TITLE_FIELD_ID;
  if (!isTitle && !property) return null;

  const name = config?.nameOverride?.trim() || property?.notionPropertyName || "";
  const shown = isTitle ? title : value || "—";

  return (
    <span
      ref={setDropRef}
      className={`flex w-full items-center gap-1 rounded border px-1 py-0.5 text-[11px] ${
        selected ? "border-emerald-600 ring-1 ring-emerald-400" : isOver ? "border-emerald-500" : dark ? "border-white/25" : "border-stone-200"
      } ${isDragging ? "opacity-40" : ""} ${dark ? "bg-black/40 text-white" : "bg-white text-stone-800"}`}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-grab items-baseline gap-1 active:cursor-grabbing"
      >
        {!isTitle && field.showLabel && (
          <span className={`shrink-0 truncate ${dark ? "text-white/60" : "text-stone-400"}`}>{name}</span>
        )}
        <span className={`min-w-0 flex-1 truncate ${isTitle ? "font-semibold" : ""}`}>{shown}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Bỏ khỏi card"
        className={`shrink-0 ${dark ? "text-white/60 hover:text-white" : "text-stone-300 hover:text-stone-700"}`}
      >
        ✕
      </button>
    </span>
  );
}

function GridSizePicker({
  label,
  grid,
  maxRows,
  onChange,
}: {
  label: string;
  grid: Grid;
  maxRows: number;
  onChange: (cols: 1 | 2, rows: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-stone-500">{label}</span>
      <div className="flex gap-1">
        {([1, 2] as const).flatMap((cols) =>
          Array.from({ length: Math.min(MAX_ROWS, maxRows) }, (_, i) => i + 1).map((rows) => {
            const selected = grid.cols === cols && grid.rows === rows;
            return (
              <button
                key={`${cols}x${rows}`}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(cols, rows)}
                title={`${cols} cột × ${rows} dòng`}
                className={`rounded border p-0.5 ${
                  selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                }`}
              >
                <GridGlyph cols={cols} rows={rows} selected={selected} />
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function CardRatioPicker({ value, onChange }: { value: CardRatio; onChange: (value: CardRatio) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-stone-500">Ảnh / chữ</span>
      <div className="flex gap-1">
        {CARD_RATIOS.map((ratio) => {
          const selected = ratio[0] === value[0];
          return (
            <button
              key={ratio.join("-")}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(ratio)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                selected
                  ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                  : "border-stone-300 text-stone-600 hover:border-stone-500"
              }`}
            >
              {ratio[0]}:{ratio[1]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { MAX_COLS };
