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
  CARD_RATIOS,
  MAX_OVERLAY_FIELDS,
  type CardField,
  type CardRatio,
  type CardSpan,
  type CoverPlacement,
} from "@/lib/card-layout";
import { COVER_RATIOS, type CoverAspect } from "@/lib/notion-cover";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";

type CoverShape = { aspect: Exclude<CoverAspect, "none">; ratio: string };

const ASPECT_LABELS: { value: CoverShape["aspect"]; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
];

export type EditableCardProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
};

type Zone = "overlay" | "side" | "below-0" | "below-1";

type Draft = {
  cover: CoverPlacement;
  span: CardSpan;
  ratio: CardRatio;
  overlay: CardField[];
  side: CardField[];
  below: { kind: "single" | "two-col"; ratio: CardRatio; cells: CardField[][] };
};

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
  const [shapeOpen, setShapeOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const coverRatio = shape.ratio.replace(":", " / ");

  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, { error: null });

  const sensors = useSensors(
    // A small threshold keeps a click on the label checkbox from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const byId = new Map(properties.map((p) => [p.notionPropertyId, p]));
  const zoneFields = (zone: Zone): CardField[] =>
    zone === "overlay" ? draft.overlay
    : zone === "side" ? draft.side
    : draft.below.cells[zone === "below-0" ? 0 : 1] ?? [];

  const placed = new Set(
    [draft.overlay, draft.side, ...draft.below.cells].flat().map((f) => f.id),
  );
  const tray = properties.filter((p) => !placed.has(p.notionPropertyId));

  function withZone(current: Draft, zone: Zone, next: CardField[]): Draft {
    if (zone === "overlay") return { ...current, overlay: next };
    if (zone === "side") return { ...current, side: next };
    const index = zone === "below-0" ? 0 : 1;
    const cells = [...current.below.cells];
    cells[index] = next;
    return { ...current, below: { ...current.below, cells } };
  }

  function zoneOf(current: Draft, id: string): Zone | null {
    if (current.overlay.some((f) => f.id === id)) return "overlay";
    if (current.side.some((f) => f.id === id)) return "side";
    if (current.below.cells[0]?.some((f) => f.id === id)) return "below-0";
    if (current.below.cells[1]?.some((f) => f.id === id)) return "below-1";
    return null;
  }

  /** Moves a field into a zone, before a given neighbour when one is named. */
  function place(id: string, target: Zone | "tray", beforeId?: string) {
    setDraft((current) => {
      const existing =
        [current.overlay, current.side, ...current.below.cells].flat().find((f) => f.id === id) ??
        { id, showLabel: true };

      // Lift out of wherever it was first, so a move within one zone reorders cleanly.
      let next: Draft = { ...current };
      for (const zone of ["overlay", "side", "below-0", "below-1"] as Zone[]) {
        const fields = zoneFieldsOf(next, zone);
        if (fields.some((f) => f.id === id)) next = withZone(next, zone, fields.filter((f) => f.id !== id));
      }
      if (target === "tray") return next;

      if (target === "overlay" && next.overlay.length >= MAX_OVERLAY_FIELDS) return current;

      const fields = [...zoneFieldsOf(next, target)];
      const at = beforeId ? fields.findIndex((f) => f.id === beforeId) : -1;
      if (at === -1) fields.push(existing);
      else fields.splice(at, 0, existing);
      return withZone(next, target, fields);
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const id = String(active.id).replace("field:", "");
    const target = String(over.id);

    if (target.startsWith("zone:")) place(id, target.slice(5) as Zone | "tray");
    else if (target.startsWith("before:")) {
      const beforeId = target.slice(7);
      if (beforeId === id) return;
      const zone = zoneOf(draft, beforeId);
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
        side: flip(current.side),
        below: { ...current.below, cells: current.below.cells.map(flip) },
      };
    });

  const setCover = (cover: CoverPlacement) =>
    setDraft((current) => ({
      ...current,
      cover,
      // Nothing can sit beside a cover that is no longer on the side.
      side: cover === "left" ? current.side : [],
      overlay: cover === "off" ? [] : current.overlay,
      span: cover === "left" ? 2 : current.span,
    }));

  const setBelowKind = (kind: "single" | "two-col") =>
    setDraft((current) => ({
      ...current,
      below: {
        ...current.below,
        kind,
        cells:
          kind === "two-col"
            ? [current.below.cells[0] ?? [], current.below.cells[1] ?? []]
            : // Collapsing merges rather than discards — losing fields to a layout tweak
              // would be the worst possible surprise here.
              [[...(current.below.cells[0] ?? []), ...(current.below.cells[1] ?? [])]],
      },
    }));

  const activeProperty = dragging ? byId.get(dragging) : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="layout" value={JSON.stringify({ ...draft, version: 2 })} />
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
            <Toolbar
              draft={draft}
              shape={shape}
              shapeOpen={shapeOpen}
              onToggleShape={() => setShapeOpen((open) => !open)}
              onShape={setShape}
              onCover={setCover}
              onSpan={(span) => setDraft((c) => ({ ...c, span }))}
              onRatio={(ratio) => setDraft((c) => ({ ...c, ratio }))}
              onBelowKind={setBelowKind}
              onBelowRatio={(ratio) => setDraft((c) => ({ ...c, below: { ...c.below, ratio } }))}
            />

            <Canvas
              draft={draft}
              coverRatio={coverRatio}
              coverUrl={previewCoverUrl}
              title={previewTitle}
              byId={byId}
              values={previewValues}
              zoneFields={zoneFields}
              onToggleLabel={toggleLabel}
              onRemove={(id) => place(id, "tray")}
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

function zoneFieldsOf(draft: Draft, zone: Zone): CardField[] {
  if (zone === "overlay") return draft.overlay;
  if (zone === "side") return draft.side;
  return draft.below.cells[zone === "below-0" ? 0 : 1] ?? [];
}

/** Vertical rail of properties not yet placed, mirroring the detail builder. */
function Tray({ properties }: { properties: EditableCardProperty[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "zone:tray" });

  return (
    <aside className="w-56 shrink-0">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
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

function Toolbar({
  draft,
  shape,
  shapeOpen,
  onToggleShape,
  onShape,
  onCover,
  onSpan,
  onRatio,
  onBelowKind,
  onBelowRatio,
}: {
  draft: Draft;
  shape: CoverShape;
  shapeOpen: boolean;
  onToggleShape: () => void;
  onShape: (value: CoverShape) => void;
  onCover: (value: CoverPlacement) => void;
  onSpan: (value: CardSpan) => void;
  onRatio: (value: CardRatio) => void;
  onBelowKind: (value: "single" | "two-col") => void;
  onBelowRatio: (value: CardRatio) => void;
}) {
  return (
    <div className="relative mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-stone-200 px-4 py-3">
      <Group label="Ảnh bìa">
        <Choice active={draft.cover === "top"} onClick={() => onCover("top")}>
          Trên
        </Choice>
        <Choice active={draft.cover === "left"} onClick={() => onCover("left")}>
          Bên trái
        </Choice>
        <Choice active={draft.cover === "off"} onClick={() => onCover("off")}>
          Ẩn
        </Choice>
        {draft.cover !== "off" && (
          <button
            type="button"
            onClick={onToggleShape}
            aria-expanded={shapeOpen}
            className={`rounded border px-2 py-1 font-mono text-xs ${
              shapeOpen
                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                : "border-stone-300 text-stone-600 hover:border-stone-400"
            }`}
          >
            {shape.ratio} ▾
          </button>
        )}
      </Group>

      {shapeOpen && draft.cover !== "off" && (
        <CoverShapePopover shape={shape} onShape={onShape} onClose={onToggleShape} />
      )}

      {draft.cover === "left" && (
        <Group label="Ảnh / chữ">
          {CARD_RATIOS.map((ratio) => (
            <Choice
              key={ratio.join("-")}
              active={draft.ratio[0] === ratio[0]}
              onClick={() => onRatio(ratio)}
              mono
            >
              {ratio[0]}:{ratio[1]}
            </Choice>
          ))}
        </Group>
      )}

      <Group label="Vùng dưới">
        <Choice active={draft.below.kind === "single"} onClick={() => onBelowKind("single")}>
          1 cột
        </Choice>
        <Choice active={draft.below.kind === "two-col"} onClick={() => onBelowKind("two-col")}>
          2 cột
        </Choice>
      </Group>

      {draft.below.kind === "two-col" && (
        <Group label="Tỉ lệ dưới">
          {CARD_RATIOS.map((ratio) => (
            <Choice
              key={ratio.join("-")}
              active={draft.below.ratio[0] === ratio[0]}
              onClick={() => onBelowRatio(ratio)}
              mono
            >
              {ratio[0]}:{ratio[1]}
            </Choice>
          ))}
        </Group>
      )}

      <Group label="Rộng">
        <Choice active={draft.span === 1} onClick={() => onSpan(1)}>
          1 cột
        </Choice>
        <Choice active={draft.span === 2} onClick={() => onSpan(2)}>
          2 cột
        </Choice>
      </Group>
    </div>
  );
}

/** Cover orientation and ratio, inline so arranging a card never means leaving the page. */
function CoverShapePopover({
  shape,
  onShape,
  onClose,
}: {
  shape: CoverShape;
  onShape: (value: CoverShape) => void;
  onClose: () => void;
}) {
  const ratios = COVER_RATIOS[shape.aspect];

  return (
    <div className="absolute left-4 top-full z-30 mt-2 w-80 rounded-lg border border-stone-200 bg-white p-4 shadow-lg">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-400">Khung ảnh</span>
        <button type="button" onClick={onClose} className="text-xs text-stone-400 hover:text-stone-700">
          Đóng
        </button>
      </div>

      <div className="mb-3 flex gap-1">
        {ASPECT_LABELS.map((option) => (
          <Choice
            key={option.value}
            active={shape.aspect === option.value}
            onClick={() => onShape({ aspect: option.value, ratio: COVER_RATIOS[option.value][0] })}
          >
            {option.label}
          </Choice>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {ratios.map((ratio) => (
          <Choice key={ratio} mono active={shape.ratio === ratio} onClick={() => onShape({ ...shape, ratio })}>
            {ratio}
          </Choice>
        ))}
        <span
          className="ml-2 rounded border border-dashed border-stone-300 bg-stone-100"
          style={{ aspectRatio: shape.ratio.replace(":", " / "), height: 34 }}
        />
      </div>

      <p className="mt-3 text-[11px] text-stone-400">
        Áp dụng khi bấm Lưu bố cục. Nguồn ảnh chọn ở trang Ảnh bìa.
      </p>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-stone-400">{label}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function Choice({
  active,
  disabled,
  mono,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  mono?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${mono ? "font-mono" : ""} ${
        active
          ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
          : "border-stone-300 text-stone-600 hover:border-stone-400"
      }`}
    >
      {children}
    </button>
  );
}

/** The card itself, at card proportions, with every region a drop target. */
function Canvas({
  draft,
  coverRatio,
  coverUrl,
  title,
  byId,
  values,
  zoneFields,
  onToggleLabel,
  onRemove,
}: {
  draft: Draft;
  coverRatio: string | null;
  coverUrl: string | null;
  title: string;
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
  zoneFields: (zone: Zone) => CardField[];
  onToggleLabel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const showCover = draft.cover !== "off" && coverRatio;

  const cover = showCover && (
    <div
      className="relative shrink-0 overflow-hidden rounded bg-stone-200 bg-cover bg-center"
      style={{
        aspectRatio: coverRatio,
        ...(draft.cover === "left" ? { width: `${draft.ratio[0]}%` } : { width: "100%" }),
        ...(coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : {}),
      }}
    >
      <DropRegion
        zone="overlay"
        label={`Đè lên ảnh · tối đa ${MAX_OVERLAY_FIELDS}`}
        fields={zoneFields("overlay")}
        byId={byId}
        values={values}
        onToggleLabel={onToggleLabel}
        onRemove={onRemove}
        tone="dark"
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent"
      />
    </div>
  );

  const side = draft.cover === "left" && (
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
      <p className="truncate font-medium text-stone-900">{title}</p>
      <DropRegion
        zone="side"
        label="Cạnh ảnh"
        fields={zoneFields("side")}
        byId={byId}
        values={values}
        onToggleLabel={onToggleLabel}
        onRemove={onRemove}
      />
    </div>
  );

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className={`mx-auto ${draft.span === 2 ? "max-w-3xl" : "max-w-sm"}`}>
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <div className={draft.cover === "left" ? "flex" : "flex flex-col"}>
            {cover}
            {side}
          </div>

          <div className="flex flex-col gap-2 p-3">
            {draft.cover !== "left" && <p className="truncate font-medium text-stone-900">{title}</p>}

            {draft.below.kind === "single" ? (
              <DropRegion
                zone="below-0"
                label="Dưới card"
                fields={zoneFields("below-0")}
                byId={byId}
                values={values}
                onToggleLabel={onToggleLabel}
                onRemove={onRemove}
              />
            ) : (
              <div className="flex gap-2">
                <div style={{ width: `${draft.below.ratio[0]}%` }} className="min-w-0">
                  <DropRegion
                    zone="below-0"
                    label="Dưới · trái"
                    fields={zoneFields("below-0")}
                    byId={byId}
                    values={values}
                    onToggleLabel={onToggleLabel}
                    onRemove={onRemove}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <DropRegion
                    zone="below-1"
                    label="Dưới · phải"
                    fields={zoneFields("below-1")}
                    byId={byId}
                    values={values}
                    onToggleLabel={onToggleLabel}
                    onRemove={onRemove}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-stone-400">
        Kéo property từ cột trái vào vùng muốn hiện. Thả lên một property để chèn phía trên nó.
      </p>
    </div>
  );
}

function DropRegion({
  zone,
  label,
  fields,
  byId,
  values,
  onToggleLabel,
  onRemove,
  tone = "light",
  className = "",
}: {
  zone: Zone;
  label: string;
  fields: CardField[];
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
  onToggleLabel: (id: string) => void;
  onRemove: (id: string) => void;
  tone?: "light" | "dark";
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  const dark = tone === "dark";

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-12 flex-col gap-1 rounded border border-dashed p-1.5 ${className} ${
        isOver
          ? "border-emerald-500 bg-emerald-50/90"
          : dark
            ? "border-white/30"
            : "border-stone-300"
      }`}
    >
      {fields.length === 0 ? (
        <span className={`px-1 text-[11px] ${dark ? "text-white/70" : "text-stone-400"}`}>{label}</span>
      ) : (
        fields.map((field) => (
          <FieldChip
            key={field.id}
            field={field}
            property={byId.get(field.id)}
            value={values[field.id]}
            dark={dark}
            onToggleLabel={() => onToggleLabel(field.id)}
            onRemove={() => onRemove(field.id)}
          />
        ))
      )}
    </div>
  );
}

function FieldChip({
  field,
  property,
  value,
  muted,
  dark,
  onToggleLabel,
  onRemove,
}: {
  field: CardField;
  property: EditableCardProperty | undefined;
  value?: string;
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
        className="flex min-w-0 flex-1 cursor-grab select-none items-baseline gap-1.5 active:cursor-grabbing"
      >
        <span className={dark ? "text-white/50" : "text-stone-400"}>⠿</span>
        {field.showLabel && (
          <span className={`shrink-0 ${dark ? "text-white/60" : "text-stone-400"}`}>
            {property.notionPropertyName}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {muted ? property.notionPropertyName : value || "—"}
        </span>
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
