"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Icon } from "@/components/icons";
import type { EditorProperty, GalleryFields } from "@/app/galleries/[galleryId]/button-settings-actions";
import { PREFILL_LABELS, prefillModesFor, type FieldPrefill, type FormPrefill, type PrefillMode } from "@/lib/native-button";
import {
  CardCanvas,
  PropertyList,
  type EditableCardProperty,
} from "@/app/galleries/[galleryId]/settings/card/card-layout-editor";
import { LayoutPanel } from "@/app/galleries/[galleryId]/settings/card/layout-panel";
import {
  MAX_ROWS,
  TITLE_FIELD_ID,
  mergeBoxes,
  resizeGrid,
  swapGridTrack,
  unmergeBoxes,
  type CardLayout,
  type Grid,
} from "@/lib/card-layout";
import { applyDrop, asFormLayout, findLayoutField, placeField, setFieldLabel, setFormPicture } from "@/lib/card-layout-edit";
import { FORM_FIELD_TYPES } from "@/lib/create-form";
import { matchesPropertySearch } from "@/lib/property-search";

/** Matches the "Form thêm" preview, so a form arranged here reads at the size it opens at. */
const PREVIEW_WIDTH = 440;

/**
 * Arranges a button's edit form the way "Form thêm" is arranged: drag fields from the
 * tray into the frame's boxes, split or merge boxes on the right. A tray field can also be
 * picked and added with a click. The result goes back to the button editor; nothing is
 * saved until the button is.
 */
export function ButtonFormDesigner({
  fields,
  initial,
  initialPrefill,
  onApply,
  onClose,
}: {
  fields: GalleryFields;
  /** The button's form, or the gallery's edit form to start from. */
  initial: CardLayout;
  initialPrefill?: FormPrefill;
  /** A layout, or undefined to go back to the gallery's own edit form; presets either way. */
  onApply: (layout: CardLayout | undefined, prefill: FormPrefill | undefined) => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<CardLayout>(() => asFormLayout(initial));
  const [prefill, setPrefill] = useState<FormPrefill>(initialPrefill ?? {});
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      latestClose.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  // The canvas wants card-editor properties; the form never formats, so configs stay empty.
  const byId = useMemo(
    () =>
      new Map<string, EditableCardProperty>(
        fields.properties
          .filter((property) => property.type !== "title")
          .map((property) => [
            property.id,
            {
              notionPropertyId: property.id,
              notionPropertyName: property.name,
              notionPropertyType: property.type,
              resolvedType: null,
              displayConfig: "{}",
              detailDisplayConfig: "",
            },
          ]),
      ),
    [fields],
  );

  const regionId = Object.keys(layout.regions)[0];
  const grid: Grid | undefined = layout.regions[regionId];
  const placed = new Set(Object.values(layout.regions).flatMap((g) => g.boxes.flatMap((box) => box.fields.map((f) => f.id))));
  const unplaced = [
    ...(placed.has(TITLE_FIELD_ID) ? [] : [{ id: TITLE_FIELD_ID, name: "Tiêu đề", type: "title" }]),
    ...[...byId.values()]
      .filter((p) => !placed.has(p.notionPropertyId) && FORM_FIELD_TYPES.has(p.notionPropertyType))
      .map((p) => ({ id: p.notionPropertyId, name: p.notionPropertyName, type: p.notionPropertyType })),
  ].filter((entry) => matchesPropertySearch(entry, search));

  const inTray = selected !== null && !placed.has(selected);
  const selectedName = selected === TITLE_FIELD_ID ? "Tiêu đề" : selected ? byId.get(selected)?.notionPropertyName : null;
  const selectedField = selected && !inTray ? findLayoutField(layout, selected) : null;
  // What a preset can be depends on the type, and select-like ones offer their options.
  const titleProperty = fields.properties.find((property) => property.type === "title");
  const selectedEditor: EditorProperty | null =
    selected === TITLE_FIELD_ID
      ? (titleProperty ?? null)
      : (fields.properties.find((property) => property.id === selected && FORM_FIELD_TYPES.has(property.type)) ?? null);
  // Presets only count for fields still on the form.
  const presetsOn = (form: CardLayout): FormPrefill | undefined => {
    const onForm = new Set(Object.values(form.regions).flatMap((g) => g.boxes.flatMap((box) => box.fields.map((f) => f.id))));
    const kept = Object.fromEntries(Object.entries(prefill).filter(([id]) => onForm.has(id)));
    return Object.keys(kept).length ? kept : undefined;
  };
  const prefillOut = presetsOn(layout);

  const withGrid = (change: (grid: Grid) => Grid) =>
    setLayout((current) => ({ ...current, regions: { ...current.regions, [regionId]: change(current.regions[regionId]) } }));

  /** A click's way in: the last open box, where a dragged field most often ends up. */
  function addSelected() {
    if (!selected || !grid) return;
    const open = grid.boxes.filter((box) => !box.mergedInto);
    const target = open[open.length - 1];
    if (!target) return;
    setLayout((current) => placeField(current, selected, target.id));
  }

  function handleDragStart({ active }: DragStartEvent) {
    setDragging(String(active.id).replace("field:", ""));
  }
  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const id = String(active.id).replace("field:", "");
    setLayout((current) => applyDrop(current, id, String(over.id)));
  }

  const draggingLabel = dragging === TITLE_FIELD_ID ? "Tiêu đề" : dragging ? byId.get(dragging)?.notionPropertyName : null;

  return createPortal(
    <div
      data-form-designer
      role="presentation"
      className="fixed inset-0 z-[62] flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-2 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Thiết kế form của nút"
        className="my-auto flex w-full max-w-6xl animate-rise-in flex-col gap-4 rounded-[1.75rem] bg-surface p-4 shadow-pop ring-1 ring-line sm:p-5"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">Form của nút</h2>
          <span className="truncate text-sm text-muted">{fields.name}</span>
          <button type="button" aria-label="Đóng" onClick={onClose} className="btn btn-ghost btn-sm btn-icon ml-auto">
            <Icon name="x" />
          </button>
        </div>

        <DndContext
          id="button-form-designer"
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="flex flex-col gap-4 lg:h-[min(36rem,calc(100dvh-12rem))] lg:flex-row">
            <div className="flex min-h-56 w-full shrink-0 flex-col gap-2 lg:w-64">
              <PropertyList entries={unplaced} search={search} onSearch={setSearch} selected={selected} onSelect={setSelected} />
            </div>

            <div className="flex min-h-[22rem] min-w-0 flex-1 justify-center overflow-auto rounded-3xl bg-subtle p-6 ring-1 ring-line">
              <CardCanvas
                layout={layout}
                coverRatio="3 / 4"
                coverUrl={null}
                title="Tiêu đề"
                byId={byId}
                values={{}}
                configs={{}}
                selected={selected}
                onSelect={setSelected}
                onRemove={(id) => {
                  setLayout((current) => placeField(current, id, "tray"));
                  setSelected(null);
                }}
                cardKind="doc"
                widthOverride={PREVIEW_WIDTH}
                asInputs
              />
            </div>

            <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
              {selected && selectedName && (
                <div className="rounded-3xl border border-line bg-surface p-4">
                  <p className="mb-2 truncate text-sm font-medium text-ink">{selectedName}</p>
                  {inTray ? (
                    <button type="button" onClick={addSelected} className="btn btn-secondary btn-sm">
                      <Icon name="plus" /> Thêm vào form
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectedEditor && (
                        <PrefillControl
                          property={selectedEditor}
                          value={prefill[selected]}
                          onChange={(next) =>
                            setPrefill((current) => {
                              const rest = { ...current };
                              if (next) rest[selected] = next;
                              else delete rest[selected];
                              return rest;
                            })
                          }
                        />
                      )}
                      <label className="flex items-center gap-2 text-xs text-ink-soft">
                        <input
                          type="checkbox"
                          checked={selectedField?.showLabel ?? true}
                          onChange={(event) => setLayout((current) => setFieldLabel(current, selected, event.target.checked))}
                          className="accent-brand"
                        />
                        Hiện tên field
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setLayout((current) => placeField(current, selected, "tray"));
                          setSelected(null);
                        }}
                        className="btn btn-ghost btn-sm self-start"
                      >
                        <Icon name="x" /> Bỏ khỏi form
                      </button>
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={layout.arrangement !== "no-cover"}
                  onChange={(event) => setLayout((current) => setFormPicture(current, event.target.checked))}
                  className="accent-brand"
                />
                Ô ảnh ở đầu form — đổi được ảnh của record
              </label>
              <div className="min-h-0 flex-1">
                <LayoutPanel
                  regions={grid ? [{ id: regionId, grid }] : []}
                  regionLabel={() => "Khung form"}
                  rowCap={() => MAX_ROWS}
                  ratio={layout.ratio}
                  showRatio={false}
                  onResize={(_, cols, rows) => withGrid((g) => resizeGrid(g, cols, rows))}
                  onAlign={(_, align) => withGrid((g) => ({ ...g, align }))}
                  onRatio={() => undefined}
                  onMergeSelection={(_, boxIds) => withGrid((g) => mergeBoxes(g, boxIds))}
                  onUnmergeSelection={(_, boxIds) => withGrid((g) => unmergeBoxes(g, boxIds))}
                  onSwapTrack={(_, axis, from, to) => withGrid((g) => swapGridTrack(g, axis, from, to))}
                />
              </div>
            </div>
          </div>

          <DragOverlay>
            {draggingLabel && (
              <span className="rounded-md border border-brand bg-surface px-2.5 py-1 text-sm shadow-lg">{draggingLabel}</span>
            )}
          </DragOverlay>
        </DndContext>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button type="button" onClick={() => onApply(layout, prefillOut)} className="btn btn-primary btn-sm">
            <Icon name="check" /> Dùng form này
          </button>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Huỷ
          </button>
          <button type="button" onClick={() => onApply(undefined, presetsOn(fields.formLayout))} className="btn btn-ghost btn-sm ml-auto">
            Về form sửa của gallery
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "Điền sẵn khi mở": what one field holds when the form opens, or its current value. */
function PrefillControl({
  property,
  value,
  onChange,
}: {
  property: EditorProperty;
  value: FieldPrefill | undefined;
  onChange: (next: FieldPrefill | undefined) => void;
}) {
  const modes = prefillModesFor(property.type);
  const text = value?.value ?? "";
  const setText = (next: string) => onChange({ mode: "static", value: next });
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-subtle p-2.5">
      <label className="text-[11px] font-medium tracking-wide text-faint uppercase" htmlFor={`prefill-${property.id}`}>
        Điền sẵn khi mở
      </label>
      <select
        id={`prefill-${property.id}`}
        value={value?.mode ?? ""}
        onChange={(event) => {
          const mode = event.target.value as PrefillMode | "";
          onChange(mode ? { mode, ...(mode === "static" ? { value: "" } : {}) } : undefined);
        }}
        className="input input-sm"
      >
        <option value="">Giá trị hiện tại của record</option>
        {modes.map((mode) => (
          <option key={mode} value={mode}>
            {PREFILL_LABELS[mode]}
          </option>
        ))}
      </select>
      {value?.mode === "static" &&
        (property.type === "checkbox" ? (
          <select aria-label="Giá trị điền sẵn" value={text} onChange={(event) => setText(event.target.value)} className="input input-sm">
            <option value="false">Chưa tick</option>
            <option value="true">Đã tick</option>
          </select>
        ) : property.type === "date" ? (
          <input aria-label="Ngày điền sẵn" type="date" value={text} onChange={(event) => setText(event.target.value)} className="input input-sm" />
        ) : (property.type === "select" || property.type === "status") && property.options?.length ? (
          <select aria-label="Giá trị điền sẵn" value={text} onChange={(event) => setText(event.target.value)} className="input input-sm">
            <option value="">— chọn —</option>
            {property.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Giá trị điền sẵn"
            value={text}
            onChange={(event) => setText(event.target.value)}
            inputMode={property.type === "number" ? "decimal" : undefined}
            placeholder={property.type === "multi_select" ? "option 1, option 2" : "Giá trị"}
            className="input input-sm"
          />
        ))}
      <p className="text-[11px] text-faint">Chỉ là giá trị ban đầu — người bấm vẫn sửa được trước khi lưu.</p>
    </div>
  );
}
