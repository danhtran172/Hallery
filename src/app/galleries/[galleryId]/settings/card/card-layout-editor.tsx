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
  CARD_WIDTH_FACTOR,
  arrangementsFor,
  canExtend,
  canMerge,
  cardKindOf,
  makeGrid,
  maxRowsBesideCover,
  mergeBox,
  resizeGrid,
  spanOf,
  unmergeBox,
  type ArrangementId,
  type CardField,
  type CardLayout,
  type CoverOrientation,
  type FrameAlign,
  type Grid,
  type GridBox,
  type MergeDirection,
} from "@/lib/card-layout";
import {
  CONTENT_IMAGE,
  COVER_RATIOS,
  MAX_DETAIL_WIDTH,
  MIN_DETAIL_WIDTH,
  PAGE_COVER,
  PROPERTY_PREFIX,
} from "@/lib/notion-cover";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";
import { ArrangementGlyph, RatioGlyph } from "./glyphs";
import { PropertyPanel, type PanelProperty } from "./property-panel";
import { LayoutPanel } from "./layout-panel";

export type EditableCardProperty = PanelProperty & { detailDisplayConfig: string };
export type CoverShape = { aspect: CoverOrientation; ratio: string };

/** The two things this screen arranges. They share a format and an editor, nothing else. */
export type ViewMode = "gallery" | "detail";

const ORIENTATIONS: { value: CoverOrientation; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
];

export function CardLayoutEditor({
  galleryId,
  properties,
  initialShape,
  initialDetailShape,
  initialLayout,
  initialDetailLayout,
  initialDetailWidth,
  initialCoverSource,
  imageProperties,
  previewTitle,
  previewValues,
  previewCoverUrl,
}: {
  galleryId: string;
  properties: EditableCardProperty[];
  initialShape: CoverShape;
  initialDetailShape: CoverShape;
  initialLayout: CardLayout;
  initialDetailLayout: CardLayout;
  initialDetailWidth: number;
  initialCoverSource: string;
  imageProperties: string[];
  previewTitle: string;
  previewValues: Record<string, string>;
  previewCoverUrl: string | null;
}) {
  const [mode, setMode] = useState<ViewMode>("gallery");

  // Both arrangements live here at once so switching views costs nothing and one save
  // commits the pair — a half-saved screen is worse than a slightly larger form.
  const [galleryLayout, setGalleryLayout] = useState<CardLayout>(initialLayout);
  const [detailLayout, setDetailLayout] = useState<CardLayout>(initialDetailLayout);
  const [galleryConfigs, setGalleryConfigs] = useState<Record<string, DisplayConfig>>({});
  const [detailConfigs, setDetailConfigs] = useState<Record<string, DisplayConfig>>({});
  const [detailWidth, setDetailWidth] = useState(initialDetailWidth);
  // Where the image comes from is a property of the data, not of a view, so both share it.
  const [coverSource, setCoverSource] = useState(initialCoverSource);

  const detailMode = mode === "detail";
  const layout = detailMode ? detailLayout : galleryLayout;
  const setLayout = detailMode ? setDetailLayout : setGalleryLayout;
  const configs = detailMode ? detailConfigs : galleryConfigs;
  const setConfigs = detailMode ? setDetailConfigs : setGalleryConfigs;

  const [galleryShape, setGalleryShape] = useState<CoverShape>(initialShape);
  const [detailShape, setDetailShape] = useState<CoverShape>(initialDetailShape);
  const shape = detailMode ? detailShape : galleryShape;
  const setShape = detailMode ? setDetailShape : setGalleryShape;

  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recordPreview, setRecordPreview] = useState(true);
  const [editingLayout, setEditingLayout] = useState(false);

  /** Makes the detail match the card, which is the state it starts in before anyone edits it. */
  function syncFromGalleryCard() {
    setDetailLayout(galleryLayout);
    setDetailShape(galleryShape);
    setDetailWidth(initialDetailWidth);
    setDetailConfigs(
      Object.fromEntries(
        properties.map((p) => [
          p.notionPropertyId,
          { ...parseDisplayConfig(p.displayConfig), ...(galleryConfigs[p.notionPropertyId] ?? {}) },
        ]),
      ),
    );
    setSelected(null);
  }

  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, { error: null });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const spec = ARRANGEMENTS[layout.arrangement];
  const regions: string[] = [...spec.regions];
  const coverRatio = shape.ratio.replace(":", " / ");
  const cardKind = cardKindOf(layout.arrangement, shape.aspect, layout.extended);
  const byId = useMemo(() => new Map(properties.map((p) => [p.notionPropertyId, p])), [properties]);

  const placed = useMemo(() => {
    const ids = new Set<string>(layout.overlay.map((f) => f.id));
    const walk = (grid: Grid) => {
      for (const box of grid.boxes) box.fields.forEach((f) => ids.add(f.id));
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
      boxes: grid.boxes.map((box) => ({ ...box, fields: box.fields.filter((f) => f.id !== id) })),
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
          if (box.id === target) {
            const fields = [...box.fields];
            insert(fields, field, beforeId);
            // Dropping into a folded box is the clearest way to say "give it back".
            const rest = { ...box, fields };
            delete rest.mergedInto;
            return rest;
          }
          return box;
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
        boxes: grid.boxes.map((box) => ({ ...box, fields: flip(box.fields) })),
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

  const alignRegion = (regionId: string, align: FrameAlign) =>
    setLayout((current) => ({
      ...current,
      regions: { ...current.regions, [regionId]: { ...current.regions[regionId], align } },
    }));

  const resizeRegion = (regionId: string, cols: 1 | 2, rows: number) =>
    setLayout((current) => ({
      ...current,
      regions: { ...current.regions, [regionId]: resizeGrid(current.regions[regionId], cols, rows) },
    }));

  const applyMerge = (boxId: string, direction: MergeDirection) =>
    mapGrids((grid) => walkGrid(grid, (g) => mergeBox(g, boxId, direction)));
  const applyUnmerge = (boxId: string) => mapGrids((grid) => walkGrid(grid, (g) => unmergeBox(g, boxId)));

  const rowCap = spec.sideBySide ? maxRowsBesideCover(shape.aspect, layout.ratio, shape.ratio) : MAX_ROWS;
  const rawSelected = selected && selected !== TITLE_FIELD_ID ? (byId.get(selected) ?? null) : null;
  // The panel edits whichever view is open. A detail with no settings of its own opens on
  // the card's, which is what it is currently rendering anyway.
  const selectedProperty =
    rawSelected && detailMode
      ? { ...rawSelected, displayConfig: rawSelected.detailDisplayConfig || rawSelected.displayConfig }
      : rawSelected;
  const selectedField = selected ? findField(layout, selected) : null;
  const draggingLabel =
    dragging === TITLE_FIELD_ID ? "Tiêu đề" : dragging ? byId.get(dragging)?.notionPropertyName : null;

  return (
    <form action={formAction} className="flex h-[calc(100vh-13rem)] min-h-[32rem] gap-4 pb-2">
      <input type="hidden" name="layout" value={JSON.stringify(galleryLayout)} />
      <input type="hidden" name="detailLayout" value={JSON.stringify(detailLayout)} />
      <input type="hidden" name="coverAspect" value={galleryShape.aspect} />
      <input type="hidden" name="coverRatio" value={galleryShape.ratio} />
      <input type="hidden" name="detailCoverAspect" value={detailShape.aspect} />
      <input type="hidden" name="detailCoverRatio" value={detailShape.ratio} />
      <input type="hidden" name="detailWidth" value={detailWidth} />
      <input type="hidden" name="coverSource" value={coverSource} />
      <input type="hidden" name="propertyConfigs" value={JSON.stringify(galleryConfigs)} />
      <input type="hidden" name="detailPropertyConfigs" value={JSON.stringify(detailConfigs)} />

      <DndContext
        id="card-layout"
        sensors={sensors}
        onDragStart={({ active }: DragStartEvent) => setDragging(String(active.id).replace("field:", ""))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {/* 1 + 2 + 3 */}
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <ModeSwitch
            mode={mode}
            onChange={(next) => {
              setMode(next);
              setSelected(null);
              setEditingLayout(false);
            }}
          />

          {detailMode && (
            <DetailBar
              width={detailWidth}
              onWidth={setDetailWidth}
              onSync={syncFromGalleryCard}
            />
          )}

          <CoverSourceSelect
            value={coverSource}
            imageProperties={imageProperties}
            onChange={setCoverSource}
          />

          <div className="flex items-stretch gap-2">
            <CoverShapeButton shape={shape} onChange={changeShape} />
            <ArrangementButton
              value={layout.arrangement}
              orientation={shape.aspect}
              extended={layout.extended}
              onChange={(arrangement, extended) => {
                setArrangement(arrangement);
                setLayout((c) => ({ ...c, extended }));
              }}
            />
            <button
              type="button"
              aria-label="Chỉnh khung bố cục"
              title="Chỉnh khung bố cục"
              aria-pressed={editingLayout}
              onClick={() => {
                setEditingLayout((open) => !open);
                setSelected(null);
              }}
              className={`w-9 shrink-0 rounded-lg border text-sm ${
                editingLayout
                  ? "border-emerald-700 bg-emerald-600 text-white"
                  : "border-stone-300 bg-white text-stone-500 hover:border-stone-500"
              }`}
            >
              ✎
            </button>
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
            <div className="flex flex-1 justify-center overflow-auto p-6 pb-24">
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
                onMerge={applyMerge}
                onUnmerge={applyUnmerge}
                cardKind={cardKind}
                // A detail is sized in pixels, not in cards-per-row, so the preview shows
                // its real width rather than a thumbnail's multiple.
                widthOverride={detailMode ? detailWidth : undefined}
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
        </div>

        {/* 5 */}
        <div className="w-72 shrink-0">
          {editingLayout ? (
            <LayoutPanel
              regions={regions.map((id) => ({ id, grid: layout.regions[id] }))}
              regionLabel={(id) =>
                regions.length > 1 ? (id === "main" ? "Khung cạnh ảnh" : "Khung dưới") : "Khung nội dung"
              }
              rowCap={(id) => (id === "main" && spec.sideBySide ? rowCap : MAX_ROWS)}
              ratio={layout.ratio}
              showRatio={spec.sideBySide}
              onResize={resizeRegion}
              onAlign={alignRegion}
              onRatio={(ratio) => setLayout((c) => ({ ...c, ratio }))}
            />
          ) : (
            <PropertyPanel
              key={`${mode}:${selected ?? "none"}`}
              property={selectedProperty}
              isTitle={selected === TITLE_FIELD_ID}
              showLabel={selectedField?.showLabel ?? true}
              onToggleLabel={() => selected && setShowLabel(selected, !(selectedField?.showLabel ?? true))}
              onChange={(propertyId, config) => setConfigs((c) => ({ ...c, [propertyId]: config }))}
            />
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="fixed bottom-6 right-6 z-40 rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : "Lưu bố cục"}
        </button>

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
  return applied;
}

/* ── 0: which view is being arranged ─────────────────────────────────────── */

function ModeSwitch({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const tabs: { value: ViewMode; label: string }[] = [
    { value: "gallery", label: "Gallery card" },
    { value: "detail", label: "Card Detail" },
  ];

  return (
    <div role="tablist" aria-label="Chỉnh bố cục cho" className="flex rounded-lg border border-stone-300 bg-white p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={mode === tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
            mode === tab.value ? "bg-emerald-600 text-white" : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Width and the sync shortcut — the two settings a detail has that a card does not. */
function DetailBar({
  width,
  onWidth,
  onSync,
}: {
  width: number;
  onWidth: (width: number) => void;
  onSync: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-2">
      <label className="flex items-center gap-2 text-xs text-stone-600">
        <span className="shrink-0">Rộng</span>
        <input
          type="range"
          min={MIN_DETAIL_WIDTH}
          max={MAX_DETAIL_WIDTH}
          step={20}
          value={width}
          onChange={(event) => onWidth(Number(event.target.value))}
          className="min-w-0 flex-1 accent-emerald-600"
        />
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-stone-500">{width}px</span>
      </label>
      <button
        type="button"
        onClick={onSync}
        className="rounded-md border border-stone-300 px-2 py-1.5 text-xs font-medium text-stone-700 hover:border-emerald-600 hover:text-emerald-700"
      >
        Sync từ gallery card
      </button>
    </div>
  );
}

/**
 * Which image a cover shows. Shared by both views on purpose: the source says where the
 * picture comes from, and a card and its detail showing different pictures of the same
 * item would just look like a bug.
 */
function CoverSourceSelect({
  value,
  imageProperties,
  onChange,
}: {
  value: string;
  imageProperties: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600">
      <span className="shrink-0">Ảnh</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-1 text-xs outline-none focus:border-emerald-600"
      >
        <option value={PAGE_COVER}>Ảnh bìa của page</option>
        {imageProperties.map((name) => (
          <option key={name} value={`${PROPERTY_PREFIX}${name}`}>
            Prop: {name}
          </option>
        ))}
        <option value={CONTENT_IMAGE}>Ảnh trong nội dung page</option>
      </select>
    </label>
  );
}

/* ── 1: cover shape ──────────────────────────────────────────────────────── */

function CoverShapeButton({ shape, onChange }: { shape: CoverShape; onChange: (value: CoverShape) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(shape);

  return (
    <div className="relative flex-1">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setDraft(shape);
          setOpen((o) => !o);
        }}
        className={`flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border bg-white p-1.5 ${
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
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Chiều ảnh</p>
          <div className="mb-3 flex gap-1">
            {ORIENTATIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.aspect === option.value}
                onClick={() => setDraft({ aspect: option.value, ratio: COVER_RATIOS[option.value][0] })}
                className={`flex-1 rounded border px-2 py-1 text-xs ${
                  draft.aspect === option.value
                    ? "border-emerald-700 bg-emerald-50 font-medium text-emerald-800"
                    : "border-stone-300 text-stone-600 hover:border-stone-500"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {COVER_RATIOS[draft.aspect].map((ratio) => {
              const selected = draft.ratio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDraft({ ...draft, ratio })}
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

          <div className="mt-3 flex justify-end gap-2 border-t border-stone-200 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:border-stone-500"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
            >
              OK
            </button>
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
  extended,
  onChange,
}: {
  value: ArrangementId;
  orientation: CoverOrientation;
  extended: boolean;
  onChange: (value: ArrangementId, extended: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftArrangement, setDraftArrangement] = useState(value);
  const [draftExtended, setDraftExtended] = useState(extended);
  const options = arrangementsFor(orientation);
  const extendable = canExtend(draftArrangement, orientation);
  const kind = cardKindOf(draftArrangement, orientation, draftExtended && extendable);

  const openPicker = () => {
    setDraftArrangement(value);
    setDraftExtended(extended);
    setOpen(true);
  };

  return (
    <div className="relative flex-1">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border bg-white p-1.5 ${
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
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Ảnh nằm ở đâu</p>
          <div className="grid grid-cols-2 gap-2">
            {options.map((id) => {
              const selected = id === draftArrangement;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDraftArrangement(id)}
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

          <label
            className={`mt-3 flex items-start gap-2 text-xs ${
              extendable ? "text-stone-700" : "text-stone-400"
            }`}
          >
            <input
              type="checkbox"
              checked={extendable && draftExtended}
              disabled={!extendable}
              onChange={(event) => setDraftExtended(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Extended width
              <span className="block text-[10px]">
                {extendable
                  ? "Card rộng 120% so với card ngang thường."
                  : "Chỉ áp dụng cho card ngang; bố cục này cho ra card dọc."}
              </span>
            </span>
          </label>

          <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3">
            <span className="text-[11px] text-stone-500">
              Loại card: <b>{kind === "doc" ? "Dọc" : kind === "extra" ? "Extra ngang" : "Ngang"}</b>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:border-stone-500"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(draftArrangement, extendable && draftExtended);
                  setOpen(false);
                }}
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
              >
                OK
              </button>
            </div>
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
  onMerge: (boxId: string, direction: MergeDirection) => void;
  onUnmerge: (boxId: string) => void;
  cardKind: "ngang" | "extra" | "doc";
  /** Exact preview width in px, for views not measured in cards per row. */
  widthOverride?: number;
};

function CardCanvas(props: CanvasProps) {
  const { layout, coverRatio, coverUrl, cardKind, widthOverride } = props;
  const spec = ARRANGEMENTS[layout.arrangement];
  const wide: boolean = spec.sideBySide;
  const regions: string[] = [...spec.regions];

  const cover = spec.cover === "none" ? null : (
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

  // Same proportions the gallery uses, so the preview is a real preview.
  const previewWidth = widthOverride ?? 340 * CARD_WIDTH_FACTOR[cardKind];

  return (
    <div className="relative w-full" style={{ maxWidth: previewWidth }}>
      <div className="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm">
        {wide ? (
          <>
            <div className="flex">
              {spec.cover === "left" && cover}
              <div className="min-w-0 flex-1 p-2">
                <RegionBlock {...props} regionId="main" />
              </div>
              {spec.cover === "right" && cover}
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

    </div>
  );
}

function RegionBlock({ regionId, ...props }: CanvasProps & { regionId: string }) {
  const grid = props.layout.regions[regionId];
  if (!grid) return null;
  return <GridBlock {...props} grid={grid} />;
}

function GridBlock({ grid, ...props }: CanvasProps & { grid: Grid }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
    >
      {grid.boxes.map((box, index) => {
        if (box.mergedInto) {
          // Kept as a sliver rather than removed: the absorbing box grows over the space,
          // and this strip is where the merge can be handed back.
          return (
            <div
              key={box.id}
              className={`flex items-center justify-center rounded bg-stone-100/70 ${
                box.mergedInto === "left" ? "w-4" : "h-4"
              }`}
            >
              <button
                type="button"
                aria-label="Bỏ gộp ô"
                title="Bỏ gộp"
                onClick={() => props.onUnmerge(box.id)}
                className="text-[9px] leading-none text-stone-400 hover:text-stone-700"
              >
                ⤢
              </button>
            </div>
          );
        }
        const { colSpan, rowSpan } = spanOf(grid, index);
        return (
          <BoxSlot
            key={box.id}
            {...props}
            grid={grid}
            box={box}
            index={index}
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
  colSpan,
  rowSpan,
  ...props
}: CanvasProps & {
  grid: Grid;
  box: GridBox;
  index: number;
  colSpan: number;
  rowSpan: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${box.id}` });
  const [menuOpen, setMenuOpen] = useState(false);

  const empty = box.fields.length === 0;
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

      {/* Merging is the only per-box control; splitting lives in the layout panel. */}
      <div className="absolute right-0.5 top-0.5 z-20 flex gap-0.5">
        {empty && (mergeLeft || mergeUp) && (
          <MiniButton label="Gộp ô" onClick={() => setMenuOpen((o) => !o)}>
            <span className="px-1 text-[10px] text-stone-500">⇱</span>
          </MiniButton>
        )}
      </div>

      {menuOpen && (
        <div className="absolute right-0 top-6 z-30 w-44 rounded-lg border border-stone-300 bg-white p-2 shadow-lg">
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

export { MAX_COLS };
