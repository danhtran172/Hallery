"use client";

import { useActionState, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  MAX_OVERLAY_FIELDS,
  presetsFor,
  type CardField,
  type CardPreset,
  type CardSpan,
  type PresetOption,
} from "@/lib/card-layout";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";

export type EditableCardProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
};

type Zone = "overlay" | "body" | "tray";

export function CardLayoutEditor({
  galleryId,
  properties,
  coverAspect,
  coverRatio,
  initial,
  previewTitle,
  previewValues,
  previewCoverUrl,
}: {
  galleryId: string;
  properties: EditableCardProperty[];
  coverAspect: string | undefined;
  coverRatio: string | null;
  initial: { preset: CardPreset; span: CardSpan; fields: CardField[]; overlayFields: CardField[] };
  previewTitle: string;
  previewValues: Record<string, string>;
  previewCoverUrl: string | null;
}) {
  const presetOptions = presetsFor(coverAspect);
  const [preset, setPreset] = useState<CardPreset>(initial.preset);
  const [span, setSpan] = useState<CardSpan>(initial.span);
  const [body, setBody] = useState<CardField[]>(initial.fields);
  const [overlay, setOverlay] = useState<CardField[]>(initial.overlayFields);
  const [dragging, setDragging] = useState<string | null>(null);

  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, { error: null });

  const sensors = useSensors(
    // A small threshold keeps a click on the label checkbox from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const byId = new Map(properties.map((p) => [p.notionPropertyId, p]));
  const placed = new Set([...body, ...overlay].map((f) => f.id));
  const tray = properties.filter((p) => !placed.has(p.notionPropertyId));
  const overlayAllowed = coverAspect !== "none";
  const overlayFull = overlay.length >= MAX_OVERLAY_FIELDS;

  function zoneOf(id: string): Zone {
    if (overlay.some((f) => f.id === id)) return "overlay";
    if (body.some((f) => f.id === id)) return "body";
    return "tray";
  }

  /** Moves a field into a zone, optionally in front of a specific neighbour. */
  function place(id: string, target: Zone, beforeId?: string) {
    const field: CardField = [...overlay, ...body].find((f) => f.id === id) ?? { id, showLabel: true };
    const nextOverlay = overlay.filter((f) => f.id !== id);
    const nextBody = body.filter((f) => f.id !== id);

    const insert = (list: CardField[]) => {
      const at = beforeId ? list.findIndex((f) => f.id === beforeId) : -1;
      if (at === -1) list.push(field);
      else list.splice(at, 0, field);
    };

    if (target === "overlay") {
      if (!overlayAllowed || nextOverlay.length >= MAX_OVERLAY_FIELDS) return;
      insert(nextOverlay);
    } else if (target === "body") {
      insert(nextBody);
    }

    setOverlay(nextOverlay);
    setBody(nextBody);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const id = String(active.id).replace("field:", "");
    const target = String(over.id);

    if (target.startsWith("zone:")) place(id, target.slice(5) as Zone);
    else if (target.startsWith("before:")) {
      const beforeId = target.slice(7);
      if (beforeId !== id) place(id, zoneOf(beforeId), beforeId);
    }
  }

  const toggleLabel = (id: string) => {
    const flip = (fields: CardField[]) =>
      fields.map((f) => (f.id === id ? { ...f, showLabel: !f.showLabel } : f));
    setOverlay(flip);
    setBody(flip);
  };

  const activeProperty = dragging ? byId.get(dragging) : null;

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input
        type="hidden"
        name="layout"
        value={JSON.stringify({ preset, span, fields: body, overlayFields: overlay })}
      />

      <PresetPicker
        options={presetOptions}
        preset={preset}
        span={span}
        onPreset={(next, defaultSpan) => {
          setPreset(next);
          setSpan(defaultSpan);
        }}
        onSpan={setSpan}
      />

      <DndContext
        id="card-layout"
        sensors={sensors}
        onDragStart={({ active }: DragStartEvent) => setDragging(String(active.id).replace("field:", ""))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 flex flex-col gap-6">
            {overlayAllowed && (
              <DropZone
                id="overlay"
                title="Đè lên ảnh bìa"
                note={`Tối đa ${MAX_OVERLAY_FIELDS} prop${overlayFull ? " — đã đầy" : ""}`}
                empty="Kéo prop vào đây để hiện đè lên ảnh."
              >
                {overlay.map((field) => (
                  <FieldChip
                    key={field.id}
                    field={field}
                    property={byId.get(field.id)}
                    onToggleLabel={() => toggleLabel(field.id)}
                    onRemove={() => setOverlay((c) => c.filter((f) => f.id !== field.id))}
                  />
                ))}
              </DropZone>
            )}

            <DropZone
              id="body"
              title="Trong thân card"
              note={preset === "beside" ? "Nằm cạnh ảnh" : "Nằm dưới ảnh"}
              empty="Kéo prop vào đây."
            >
              {body.map((field) => (
                <FieldChip
                  key={field.id}
                  field={field}
                  property={byId.get(field.id)}
                  onToggleLabel={() => toggleLabel(field.id)}
                  onRemove={() => setBody((c) => c.filter((f) => f.id !== field.id))}
                />
              ))}
            </DropZone>

            <DropZone id="tray" title="Chưa dùng" note={`${tray.length} prop`} empty="Mọi prop đều đã được đặt.">
              {tray.map((property) => (
                <FieldChip
                  key={property.notionPropertyId}
                  field={{ id: property.notionPropertyId, showLabel: true }}
                  property={property}
                  muted
                />
              ))}
            </DropZone>

            {state.error && <p className="text-sm text-red-600">{state.error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
          </div>

          <CardPreview
            preset={preset}
            span={span}
            coverRatio={coverRatio}
            coverUrl={previewCoverUrl}
            title={previewTitle}
            body={body}
            overlay={overlay}
            byId={byId}
            values={previewValues}
          />
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

function PresetPicker({
  options,
  preset,
  span,
  onPreset,
  onSpan,
}: {
  options: PresetOption[];
  preset: CardPreset;
  span: CardSpan;
  onPreset: (value: CardPreset, defaultSpan: CardSpan) => void;
  onSpan: (value: CardSpan) => void;
}) {
  const active = options.find((option) => option.value === preset) ?? options[0];

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Kiểu bố cục</h2>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onPreset(option.value, option.defaultSpan)}
            aria-pressed={option.value === preset}
            className={`flex w-44 flex-col gap-2 rounded-lg border p-3 text-left ${
              option.value === preset
                ? "border-emerald-600 bg-emerald-50"
                : "border-stone-300 hover:border-stone-400"
            }`}
          >
            <PresetGlyph preset={option.value} />
            <span className="text-sm font-medium text-stone-800">{option.label}</span>
            <span className="text-[11px] leading-snug text-stone-500">{option.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs text-stone-500">Độ rộng card</span>
        {([1, 2] as CardSpan[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSpan(value)}
            aria-pressed={span === value}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              span === value
                ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
                : "border-stone-300 text-stone-600 hover:border-stone-400"
            }`}
          >
            {value === 1 ? "1 cột" : "2 cột"}
          </button>
        ))}
        {active?.defaultSpan === 2 && span === 1 && (
          <span className="text-[11px] text-amber-700">Bố cục này thường cần 2 cột mới đủ chỗ.</span>
        )}
      </div>
    </section>
  );
}

/** Tiny diagram of where the cover sits, so the choice reads at a glance. */
function PresetGlyph({ preset }: { preset: CardPreset }) {
  if (preset === "beside") {
    return (
      <span className="flex h-12 w-full gap-1 rounded border border-stone-200 bg-white p-1">
        <span className="h-full w-1/3 rounded-sm bg-stone-300" />
        <span className="flex flex-1 flex-col gap-1 pt-1">
          <span className="h-1.5 w-3/4 rounded-sm bg-stone-200" />
          <span className="h-1 w-full rounded-sm bg-stone-100" />
          <span className="h-1 w-2/3 rounded-sm bg-stone-100" />
        </span>
      </span>
    );
  }
  return (
    <span className="flex h-12 w-full flex-col gap-1 rounded border border-stone-200 bg-white p-1">
      <span className="h-1/2 w-full rounded-sm bg-stone-300" />
      <span className="h-1.5 w-3/4 rounded-sm bg-stone-200" />
      <span className="h-1 w-full rounded-sm bg-stone-100" />
    </span>
  );
}

function DropZone({
  id,
  title,
  note,
  empty,
  children,
}: {
  id: Zone;
  title: string;
  note: string;
  empty: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${id}` });
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">{title}</h2>
        <span className="text-[11px] text-stone-400">{note}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-16 flex-wrap items-start gap-2 rounded-lg border border-dashed p-3 ${
          isOver ? "border-emerald-500 bg-emerald-50" : "border-stone-300"
        }`}
      >
        {items.length === 0 ? <span className="text-xs text-stone-400">{empty}</span> : items}
      </div>
    </section>
  );
}

function FieldChip({
  field,
  property,
  muted,
  onToggleLabel,
  onRemove,
}: {
  field: CardField;
  property: EditableCardProperty | undefined;
  muted?: boolean;
  onToggleLabel?: () => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${field.id}` });
  // Dropping onto a chip inserts before it, which is how ordering happens without a
  // sortable library.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `before:${field.id}` });
  if (!property) return null;

  return (
    <span
      ref={setDropRef}
      className={`flex items-center gap-2 rounded-md border bg-white px-2 py-1 text-sm ${
        isOver ? "border-emerald-500" : "border-stone-300"
      } ${isDragging ? "opacity-40" : ""} ${muted ? "text-stone-500" : "text-stone-800"}`}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="cursor-grab select-none active:cursor-grabbing"
      >
        ⠿ {property.notionPropertyName}
      </span>

      {onToggleLabel && (
        <label className="flex items-center gap-1 text-[11px] text-stone-500">
          <input type="checkbox" checked={field.showLabel} onChange={onToggleLabel} />
          tên
        </label>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Bỏ ${property.notionPropertyName}`}
          className="text-xs text-stone-400 hover:text-stone-700"
        >
          ✕
        </button>
      )}
    </span>
  );
}

function CardPreview({
  preset,
  span,
  coverRatio,
  coverUrl,
  title,
  body,
  overlay,
  byId,
  values,
}: {
  preset: CardPreset;
  span: CardSpan;
  coverRatio: string | null;
  coverUrl: string | null;
  title: string;
  body: CardField[];
  overlay: CardField[];
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
}) {
  const cover = coverRatio && (
    <div
      className="relative shrink-0 overflow-hidden bg-stone-200 bg-cover bg-center"
      style={{
        aspectRatio: coverRatio,
        ...(preset === "beside" ? { width: "40%" } : { width: "100%" }),
        ...(coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : {}),
      }}
    >
      {overlay.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 to-transparent p-2">
          {overlay.map((field) => (
            <span key={field.id} className="truncate text-[11px] text-white">
              {field.showLabel && (
                <span className="text-white/60">{byId.get(field.id)?.notionPropertyName}: </span>
              )}
              {values[field.id] || "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
      <p className="truncate font-medium text-stone-900">{title}</p>
      {body.map((field) => (
        <span key={field.id} className="flex items-baseline gap-2 text-xs text-stone-600">
          {field.showLabel && (
            <span className="w-20 shrink-0 truncate text-stone-400">
              {byId.get(field.id)?.notionPropertyName}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{values[field.id] || "—"}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="w-full shrink-0 lg:w-80">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Xem trước</h2>
      <div
        className={`overflow-hidden rounded-lg border border-stone-200 bg-white ${
          preset === "beside" ? "flex" : "flex flex-col"
        }`}
      >
        {cover}
        {text}
      </div>
      <p className="mt-2 text-[11px] text-stone-400">
        Card chiếm {span === 2 ? "2 cột" : "1 cột"} trong lưới Gallery. Khung ảnh chỉnh ở trang Ảnh bìa.
      </p>
    </div>
  );
}
