"use client";

import { useActionState, useState } from "react";
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
  ARRANGEMENT_IDS,
  CARD_RATIOS,
  CELL_DISPLAYS,
  CELL_DISPLAY_IDS,
  MAX_OVERLAY_FIELDS,
  type ArrangementId,
  type CardCell,
  type CardField,
  type CardRatio,
  type CardSpan,
  type CellDisplay,
} from "@/lib/card-layout";
import { COVER_RATIOS, type CoverAspect } from "@/lib/notion-cover";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";
import { ArrangementGlyph, CellDisplayGlyph, RatioGlyph } from "./glyphs";

export type EditableCardProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
};

export type CoverShape = { aspect: Exclude<CoverAspect, "none">; ratio: string };

export type Draft = {
  arrangement: ArrangementId;
  span: CardSpan;
  ratio: CardRatio;
  overlay: CardField[];
  cells: Record<string, CardCell>;
};

const ASPECT_LABELS: { value: CoverShape["aspect"]; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
];

export function CardLayoutEditor({
  galleryId,
  properties,
  initialShape,
  initial,
  previewTitle,
  previewValues,
  previewCoverUrl,
}: {
  galleryId: string;
  properties: EditableCardProperty[];
  initialShape: CoverShape;
  initial: Draft;
  previewTitle: string;
  previewValues: Record<string, string>;
  previewCoverUrl: string | null;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [shape, setShape] = useState<CoverShape>(initialShape);
  const [dragging, setDragging] = useState<string | null>(null);

  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, { error: null });

  const sensors = useSensors(
    // A small threshold keeps a click on the label checkbox from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const spec = ARRANGEMENTS[draft.arrangement];
  const coverRatio = shape.ratio.replace(":", " / ");
  const byId = new Map(properties.map((p) => [p.notionPropertyId, p]));

  const placed = new Set(
    [draft.overlay, ...Object.values(draft.cells).map((c) => c.fields)].flat().map((f) => f.id),
  );
  const tray = properties.filter((p) => !placed.has(p.notionPropertyId));

  function fieldsIn(zone: string): CardField[] {
    return zone === "overlay" ? draft.overlay : (draft.cells[zone]?.fields ?? []);
  }

  /** Moves a field into a zone, before a given neighbour when one is named. */
  function place(id: string, target: string, beforeId?: string) {
    setDraft((current) => {
      const existing =
        [current.overlay, ...Object.values(current.cells).map((c) => c.fields)]
          .flat()
          .find((f) => f.id === id) ?? { id, showLabel: true };

      // Lift out of wherever it was, so a move within one box reorders cleanly.
      const next: Draft = {
        ...current,
        overlay: current.overlay.filter((f) => f.id !== id),
        cells: Object.fromEntries(
          Object.entries(current.cells).map(([key, cell]) => [
            key,
            { ...cell, fields: cell.fields.filter((f) => f.id !== id) },
          ]),
        ),
      };
      if (target === "tray") return next;

      if (target === "overlay") {
        if (next.overlay.length >= MAX_OVERLAY_FIELDS) return current;
        const fields = [...next.overlay];
        insert(fields, existing, beforeId);
        return { ...next, overlay: fields };
      }

      const cell = next.cells[target];
      if (!cell) return current;
      const fields = [...cell.fields];
      insert(fields, existing, beforeId);
      return { ...next, cells: { ...next.cells, [target]: { ...cell, fields } } };
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const id = String(active.id).replace("field:", "");
    const target = String(over.id);

    if (target.startsWith("zone:")) place(id, target.slice(5));
    else if (target.startsWith("before:")) {
      const beforeId = target.slice(7);
      if (beforeId === id) return;
      const zone =
        draft.overlay.some((f) => f.id === beforeId)
          ? "overlay"
          : Object.entries(draft.cells).find(([, cell]) => cell.fields.some((f) => f.id === beforeId))?.[0];
      if (zone) place(id, zone, beforeId);
    }
  }

  const toggleLabel = (id: string) =>
    setDraft((current) => {
      const flip = (fields: CardField[]) =>
        fields.map((f) => (f.id === id ? { ...f, showLabel: !f.showLabel } : f));
      return {
        ...current,
        overlay: flip(current.overlay),
        cells: Object.fromEntries(
          Object.entries(current.cells).map(([key, cell]) => [key, { ...cell, fields: flip(cell.fields) }]),
        ),
      };
    });

  /** Switching arrangement keeps the fields: extra boxes merge into the last surviving one. */
  const setArrangement = (arrangement: ArrangementId) =>
    setDraft((current) => {
      const nextIds = ARRANGEMENTS[arrangement].cells;
      const carried = Object.values(current.cells).map((cell) => cell.fields);
      const cells: Record<string, CardCell> = {};

      nextIds.forEach((id, index) => {
        const previous = Object.values(current.cells)[index];
        const overflow = index === nextIds.length - 1 ? carried.slice(nextIds.length).flat() : [];
        cells[id] = {
          display: previous?.display ?? "rows",
          fields: [...(carried[index] ?? []), ...overflow],
        };
      });

      const loseCover = ARRANGEMENTS[arrangement].cover === "none";
      return {
        ...current,
        arrangement,
        overlay: loseCover ? [] : current.overlay,
        span: ARRANGEMENTS[arrangement].cover === "left" || arrangement === "cover-right" ? 2 : current.span,
        cells,
      };
    });

  const setCellDisplay = (cellId: string, display: CellDisplay) =>
    setDraft((current) => ({
      ...current,
      cells: { ...current.cells, [cellId]: { ...current.cells[cellId], display } },
    }));

  const activeProperty = dragging ? byId.get(dragging) : null;
  const sideways = spec.cover === "left" || spec.cover === "right";

  return (
    <form action={formAction}>
      <input type="hidden" name="layout" value={JSON.stringify({ ...draft, version: 3 })} />
      <input type="hidden" name="coverAspect" value={shape.aspect} />
      <input type="hidden" name="coverRatio" value={shape.ratio} />

      <DndContext
        id="card-layout"
        sensors={sensors}
        onDragStart={({ active }: DragStartEvent) => setDragging(String(active.id).replace("field:", ""))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex gap-6">
          <Tray properties={tray} />

          <div className="min-w-0 flex-1">
            <ArrangementPicker value={draft.arrangement} onChange={setArrangement} />

            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              <CoverShapeSelect shape={shape} onChange={setShape} disabled={spec.cover === "none"} />
              {sideways && (
                <RatioSelect
                  label="Ảnh / chữ"
                  value={draft.ratio}
                  onChange={(ratio) => setDraft((c) => ({ ...c, ratio }))}
                />
              )}
              <SpanSelect value={draft.span} onChange={(span) => setDraft((c) => ({ ...c, span }))} />
            </div>

            <Canvas
              draft={draft}
              coverRatio={coverRatio}
              coverUrl={previewCoverUrl}
              title={previewTitle}
              byId={byId}
              values={previewValues}
              fieldsIn={fieldsIn}
              onToggleLabel={toggleLabel}
              onRemove={(id) => place(id, "tray")}
              onCellDisplay={setCellDisplay}
            />

            {state.error && <p className="mt-4 text-sm text-red-600">{state.error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="mt-6 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Đang lưu…" : "Lưu bố cục"}
            </button>
          </div>
        </div>

        <DragOverlay>
          {activeProperty && (
            <span className="rounded-md border border-emerald-600 bg-white px-2.5 py-1 text-sm shadow-lg">
              {activeProperty.notionPropertyName}
            </span>
          )}
        </DragOverlay>
      </DndContext>
    </form>
  );
}

function insert(fields: CardField[], field: CardField, beforeId?: string) {
  const at = beforeId ? fields.findIndex((f) => f.id === beforeId) : -1;
  if (at === -1) fields.push(field);
  else fields.splice(at, 0, field);
}

/* ── Layer 1 ─────────────────────────────────────────────────────────────── */

function ArrangementPicker({
  value,
  onChange,
}: {
  value: ArrangementId;
  onChange: (value: ArrangementId) => void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
        Vị trí các ô so với ảnh
      </legend>
      <div className="flex flex-wrap gap-2">
        {ARRANGEMENT_IDS.map((id) => {
          const selected = id === value;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(id)}
              className={`w-28 rounded-md border p-2 text-left transition-colors ${
                selected
                  ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                  : "border-stone-300 bg-white text-stone-700 hover:border-stone-500 hover:bg-stone-50"
              }`}
            >
              <ArrangementGlyph id={id} selected={selected} />
              <span className="mt-2 block text-[11px] font-medium leading-tight">
                {ARRANGEMENTS[id].label}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ── Pickers ─────────────────────────────────────────────────────────────── */

function Popover({
  label,
  summary,
  glyph,
  children,
}: {
  label: string;
  summary: string;
  glyph: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <fieldset className="relative">
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">{label}</legend>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-10 items-center gap-2 rounded-md border bg-white px-2 text-left ${
          open ? "border-emerald-700" : "border-stone-300 hover:border-stone-500"
        }`}
      >
        {glyph}
        <span className="text-xs font-medium text-stone-800">{summary}</span>
        <span aria-hidden className="text-stone-400">⌄</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-stone-300 bg-white p-3 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </fieldset>
  );
}

function CoverShapeSelect({
  shape,
  onChange,
  disabled,
}: {
  shape: CoverShape;
  onChange: (value: CoverShape) => void;
  disabled: boolean;
}) {
  if (disabled) return null;

  return (
    <Popover
      label="Khung ảnh"
      summary={shape.ratio}
      glyph={<RatioGlyph ratio={shape.ratio} selected />}
    >
      {(close) => (
        <>
          <div className="mb-3 flex gap-1">
            {ASPECT_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={shape.aspect === option.value}
                onClick={() => onChange({ aspect: option.value, ratio: COVER_RATIOS[option.value][0] })}
                className={`rounded border px-2 py-1 text-xs ${
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
                    close();
                  }}
                  className={`flex flex-col items-center gap-1 rounded-md border p-2 ${
                    selected
                      ? "border-emerald-700 bg-emerald-50"
                      : "border-stone-300 hover:border-stone-500 hover:bg-stone-50"
                  }`}
                >
                  <RatioGlyph ratio={ratio} selected={selected} />
                  <span className="font-mono text-[11px] text-stone-700">{ratio}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Popover>
  );
}

function RatioSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CardRatio;
  onChange: (value: CardRatio) => void;
}) {
  return (
    <Popover
      label={label}
      summary={`${value[0]}:${value[1]}`}
      glyph={<SplitGlyph left={value[0]} selected />}
    >
      {(close) => (
        <div className="grid grid-cols-3 gap-2">
          {CARD_RATIOS.map((ratio) => {
            const selected = ratio[0] === value[0];
            return (
              <button
                key={ratio.join("-")}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onChange(ratio);
                  close();
                }}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 ${
                  selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                }`}
              >
                <SplitGlyph left={ratio[0]} selected={selected} />
                <span className="font-mono text-[11px] text-stone-700">
                  {ratio[0]}:{ratio[1]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function SplitGlyph({ left, selected }: { left: number; selected: boolean }) {
  const cell = `rounded-[2px] border ${selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100"}`;
  return (
    <span aria-hidden className="flex h-7 w-12 shrink-0 gap-1 rounded-sm bg-stone-200/70 p-1">
      <span className={cell} style={{ width: `${left}%` }} />
      <span className={`${cell} flex-1`} />
    </span>
  );
}

function SpanSelect({ value, onChange }: { value: CardSpan; onChange: (value: CardSpan) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
        Rộng trong lưới
      </legend>
      <div className="flex gap-1">
        {([1, 2] as CardSpan[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`flex h-10 items-center gap-1.5 rounded-md border px-2 text-xs ${
              value === option
                ? "border-emerald-700 bg-emerald-50 font-medium text-emerald-800"
                : "border-stone-300 text-stone-600 hover:border-stone-500"
            }`}
          >
            <span aria-hidden className="flex h-5 w-8 gap-0.5 rounded-sm bg-stone-200/70 p-0.5">
              <span className={`flex-1 rounded-[1px] ${value === option ? "bg-emerald-300" : "bg-stone-300"}`} />
              {option === 1 && <span className="flex-1 rounded-[1px] bg-transparent" />}
            </span>
            {option} cột
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/* ── Canvas ──────────────────────────────────────────────────────────────── */

function Tray({ properties }: { properties: EditableCardProperty[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "zone:tray" });

  return (
    <aside className="w-56 shrink-0">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
        Chưa dùng · {properties.length}
      </h2>
      <div
        ref={setNodeRef}
        className={`sticky top-4 flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto rounded-lg border border-dashed p-2 ${
          isOver ? "border-emerald-500 bg-emerald-50" : "border-stone-300"
        }`}
      >
        {properties.length === 0 ? (
          <p className="px-1 py-2 text-xs text-stone-400">Mọi property đều đã được đặt.</p>
        ) : (
          properties.map((property) => (
            <FieldChip
              key={property.notionPropertyId}
              field={{ id: property.notionPropertyId, showLabel: true }}
              property={property}
              muted
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Canvas({
  draft,
  coverRatio,
  coverUrl,
  title,
  byId,
  values,
  fieldsIn,
  onToggleLabel,
  onRemove,
  onCellDisplay,
}: {
  draft: Draft;
  coverRatio: string;
  coverUrl: string | null;
  title: string;
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
  fieldsIn: (zone: string) => CardField[];
  onToggleLabel: (id: string) => void;
  onRemove: (id: string) => void;
  onCellDisplay: (cellId: string, display: CellDisplay) => void;
}) {
  const spec = ARRANGEMENTS[draft.arrangement];
  const hasCover = spec.cover !== "none";

  const cover = hasCover && (
    <div
      className="relative shrink-0 overflow-hidden rounded bg-stone-200 bg-cover bg-center"
      style={{
        aspectRatio: coverRatio,
        width: spec.cover === "left" || spec.cover === "right" ? `${draft.ratio[0]}%` : "100%",
        ...(coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : {}),
      }}
    >
      <DropBox
        zone="overlay"
        label={`Đè lên ảnh · tối đa ${MAX_OVERLAY_FIELDS}`}
        fields={fieldsIn("overlay")}
        display="stacked"
        byId={byId}
        values={values}
        onToggleLabel={onToggleLabel}
        onRemove={onRemove}
        dark
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent"
      />
    </div>
  );

  const box = (cellId: string, label: string) => (
    <DropBox
      key={cellId}
      zone={cellId}
      label={label}
      fields={fieldsIn(cellId)}
      display={draft.cells[cellId]?.display ?? "rows"}
      byId={byId}
      values={values}
      onToggleLabel={onToggleLabel}
      onRemove={onRemove}
      onDisplay={(value) => onCellDisplay(cellId, value)}
    />
  );

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className={`mx-auto ${draft.span === 2 ? "max-w-3xl" : "max-w-sm"}`}>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          {spec.cover === "left" || spec.cover === "right" ? (
            <>
              <div className="flex">
                {spec.cover === "left" && cover}
                <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                  <p className="truncate font-medium text-stone-900">{title}</p>
                  {box(spec.cells[0], "Ô cạnh ảnh")}
                </div>
                {spec.cover === "right" && cover}
              </div>
              {spec.cells[1] && <div className="p-3 pt-0">{box(spec.cells[1], "Ô dưới")}</div>}
            </>
          ) : (
            <div className="flex flex-col">
              {cover}
              <div className="flex flex-col gap-2 p-3">
                <p className="truncate font-medium text-stone-900">{title}</p>
                {spec.cells.length === 2 ? (
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">{box(spec.cells[0], "Ô trái")}</div>
                    <div className="min-w-0 flex-1">{box(spec.cells[1], "Ô phải")}</div>
                  </div>
                ) : (
                  spec.cells.map((id) => box(id, "Ô nội dung"))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-stone-400">
        Kéo property từ cột trái vào ô. Thả lên một property để chèn phía trên nó. Nút ở góc mỗi ô đổi cách bày
        property bên trong.
      </p>
    </div>
  );
}

function DropBox({
  zone,
  label,
  fields,
  display,
  byId,
  values,
  onToggleLabel,
  onRemove,
  onDisplay,
  dark,
  className = "",
}: {
  zone: string;
  label: string;
  fields: CardField[];
  display: CellDisplay;
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
  onToggleLabel: (id: string) => void;
  onRemove: (id: string) => void;
  onDisplay?: (value: CellDisplay) => void;
  dark?: boolean;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className={`relative rounded border border-dashed p-1.5 ${className} ${
        isOver ? "border-emerald-500 bg-emerald-50/90" : dark ? "border-white/30" : "border-stone-300"
      }`}
    >
      {onDisplay && (
        <div className="absolute right-1 top-1 z-20">
          <button
            type="button"
            aria-label="Cách bày property trong ô"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
            className={`rounded border bg-white p-0.5 ${
              pickerOpen ? "border-emerald-700" : "border-stone-300 hover:border-stone-500"
            }`}
          >
            <CellDisplayGlyph display={display} selected={pickerOpen} />
          </button>
          {pickerOpen && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-stone-300 bg-white p-2 shadow-lg">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                Bày property thế nào
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {CELL_DISPLAY_IDS.map((option) => {
                  const selected = option === display;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onDisplay(option);
                        setPickerOpen(false);
                      }}
                      className={`flex flex-col items-center gap-1 rounded-md border p-1.5 ${
                        selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                      }`}
                    >
                      <CellDisplayGlyph display={option} selected={selected} />
                      <span className="text-center text-[10px] leading-tight text-stone-600">
                        {CELL_DISPLAYS[option].label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {fields.length === 0 ? (
        <span className={`block px-1 py-2 text-[11px] ${dark ? "text-white/70" : "text-stone-400"}`}>
          {label}
        </span>
      ) : (
        <div className={display === "two-col" ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"}>
          {fields.map((field) => (
            <FieldChip
              key={field.id}
              field={field}
              property={byId.get(field.id)}
              value={values[field.id]}
              display={display}
              dark={dark}
              onToggleLabel={() => onToggleLabel(field.id)}
              onRemove={() => onRemove(field.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldChip({
  field,
  property,
  value,
  display = "rows",
  muted,
  dark,
  onToggleLabel,
  onRemove,
}: {
  field: CardField;
  property: EditableCardProperty | undefined;
  value?: string;
  display?: CellDisplay;
  muted?: boolean;
  dark?: boolean;
  onToggleLabel?: () => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${field.id}` });
  // Dropping onto a chip inserts above it — that is how ordering happens without a
  // sortable library.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `before:${field.id}` });
  if (!property) return null;

  const stacked = display === "stacked";

  return (
    <span
      ref={setDropRef}
      className={`flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-xs ${
        isOver ? "border-emerald-500" : dark ? "border-white/25" : "border-stone-300"
      } ${isDragging ? "opacity-40" : ""} ${
        dark ? "bg-black/35 text-white" : muted ? "bg-white text-stone-500" : "bg-white text-stone-800"
      }`}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`flex min-w-0 flex-1 cursor-grab select-none gap-1.5 active:cursor-grabbing ${
          stacked ? "flex-col items-start" : "items-baseline"
        }`}
      >
        <span className={`shrink-0 ${dark ? "text-white/50" : "text-stone-400"}`}>⠿</span>
        {field.showLabel && (
          <span className={`shrink-0 ${dark ? "text-white/60" : "text-stone-400"}`}>
            {property.notionPropertyName}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{muted ? property.notionPropertyName : value || "—"}</span>
      </span>

      {onToggleLabel && (
        <label className={`flex shrink-0 items-center gap-1 ${dark ? "text-white/60" : "text-stone-400"}`}>
          <input type="checkbox" checked={field.showLabel} onChange={onToggleLabel} />
          tên
        </label>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Bỏ ${property.notionPropertyName}`}
          className={`shrink-0 ${dark ? "text-white/60 hover:text-white" : "text-stone-400 hover:text-stone-700"}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}
