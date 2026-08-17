"use client";

import Link from "next/link";
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
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { PropertyDisplayConfigForm, type DisplayConfigProperty } from "@/components/property-display-config-form";
import {
  getPlacedPropertyIds,
  applyLayoutTemplate,
  layoutCellCount,
  layoutUsesColumns,
  MAX_STACK_LAYOUT_CELLS,
  type DetailLayout,
  type DetailLayoutCell,
  type DetailLayoutNode,
  type LayoutKind,
  type LayoutRatio,
} from "@/lib/detail-layout";
import { saveDetailLayout, saveLayoutTemplate, type SaveLayoutState, type SaveTemplateState } from "./actions";

type BuilderProperty = DisplayConfigProperty & {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  sortOrder: number;
  isMissing: boolean;
};

const ROOT_KIND_OPTIONS: { value: LayoutKind; label: string }[] = [
  { value: "single", label: "Một ô" },
  { value: "two-col", label: "Hai cột" },
  { value: "two-col-split-left", label: "Hai cột, trái chia đôi" },
  { value: "two-col-split-right", label: "Hai cột, phải chia đôi" },
  { value: "stack", label: "Hai hàng" },
];

const RATIO_OPTIONS: { value: LayoutRatio; label: string }[] = [
  { value: [50, 50], label: "50 / 50" },
  { value: [60, 40], label: "60 / 40" },
  { value: [40, 60], label: "40 / 60" },
  { value: [70, 30], label: "70 / 30" },
  { value: [30, 70], label: "30 / 70" },
];

export function LayoutBuilder({
  galleryId,
  galleryName,
  properties,
  initialLayout,
  templates,
}: {
  galleryId: string;
  galleryName: string;
  properties: BuilderProperty[];
  initialLayout: DetailLayout;
  templates: { id: string; name: string; layout: string }[];
}) {
  const [layout, setLayout] = useState(initialLayout);
  const [query, setQuery] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const saveAction = saveDetailLayout.bind(null, galleryId);
  const [saveState, formAction, pending] = useActionState<SaveLayoutState, FormData>(saveAction, { error: null });
  const wasPending = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const selectedProperty = properties.find((property) => property.notionPropertyId === selectedPropertyId) ?? null;
  const placed = useMemo(() => getPlacedPropertyIds(layout), [layout]);
  const unplaced = properties.filter(
    (property) =>
      property.notionPropertyType !== "title" &&
      !property.isMissing &&
      !placed.has(property.notionPropertyId) &&
      property.notionPropertyName.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")),
  );

  useEffect(() => {
    if (wasPending.current && !pending && !saveState.error) setDirty(false);
    wasPending.current = pending;
  }, [pending, saveState.error]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateLayout(next: DetailLayout) {
    setLayout(next);
    setDirty(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    const propertyId = String(event.active.id).replace(/^property:/, "");
    const overId = event.over ? String(event.over.id) : "";
    if (!event.over || !propertyId || !overId) return;

    if (overId === "tray") {
      updateLayout(moveProperty(layout, propertyId, null));
      return;
    }

    const targetProperty = overId.startsWith("property:") ? overId.slice("property:".length) : null;
    const targetCellId = targetProperty ? findPropertyCell(layout.root, targetProperty) : overId.replace(/^cell:/, "");
    if (!targetCellId) return;
    updateLayout(moveProperty(layout, propertyId, targetCellId, targetProperty));
  }

  function handleRootKindChange(kind: LayoutKind) {
    const reshaped = reshapeRoot(layout.root, kind);
    updateLayout({ ...layout, root: reshaped.node });
    setLayoutNotice(reshaped.consolidated ? "Property từ ô bị gộp đã được dồn vào ô cuối cùng; không có dữ liệu nào bị bỏ." : null);
  }

  function handleRootRatioChange(ratio: LayoutRatio) {
    updateLayout({ ...layout, root: { ...layout.root, ratio } });
  }

  function handleNestedKindChange(cellId: string, kind: LayoutKind | "none") {
    const updated = updateNestedKind(layout.root, cellId, kind);
    updateLayout({ ...layout, root: updated.node });
    setLayoutNotice(updated.consolidated ? "Property từ ô bị gộp đã được dồn vào ô cuối cùng; không có dữ liệu nào bị bỏ." : null);
  }

  function handleNestedRatioChange(cellId: string, ratio: LayoutRatio) {
    updateLayout({ ...layout, root: updateNestedRatio(layout.root, cellId, ratio) });
  }

  function handleAddSiblingLayout(containerId: string) {
    updateLayout({ ...layout, root: addSiblingLayout(layout.root, containerId) });
  }

  function resetLayout() {
    if (dirty && !window.confirm("Bỏ toàn bộ thay đổi bố cục chưa lưu?")) return;
    setLayout(initialLayout);
    setDirty(false);
    setSelectedPropertyId(null);
  }

  function applyTemplate(templateId: string): { message: string | null } {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) return { message: "Chọn một mẫu để áp dụng." };
    const applied = applyLayoutTemplate(template.layout, properties);
    if (applied.invalid) return { message: "Mẫu này không hợp lệ và không thể áp dụng." };
    updateLayout(applied.layout);
    if (!applied.missingPropertyCount) return { message: "Đã đặt mẫu vào canvas. Nhấn Lưu bố cục để áp dụng." };
    return { message: `${applied.missingPropertyCount} property trong mẫu không có trong database này nên đã ở lại kho bên trái.` };
  }

  return (
    <>
    <Link
      href={`/galleries/${galleryId}`}
      onNavigate={(event) => {
        if (dirty && !window.confirm("Bạn có thay đổi bố cục chưa lưu. Rời trang và bỏ các thay đổi này?")) {
          event.preventDefault();
        }
      }}
      className="mb-4 inline-block text-xs text-stone-500 hover:underline"
    >
      ← {galleryName}
    </Link>
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <DndContext id="layout-builder" sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <PropertyTray properties={unplaced} query={query} onQueryChange={setQuery} />
          <section className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-5">
            <div className="mb-5 grid gap-4 border-b border-stone-200 pb-5 lg:grid-cols-[minmax(0,1fr)_10rem] lg:items-end">
              <LayoutKindPicker
                label="Kiểu chia ô tổng"
                value={layout.root.kind}
                onChange={(kind) => {
                  if (kind !== "none") handleRootKindChange(kind);
                }}
              />
              {layoutUsesColumns(layout.root.kind) && (
                <RatioSelect value={layout.root.ratio ?? [50, 50]} onChange={handleRootRatioChange} />
              )}
            </div>

            <LayoutCanvas
              node={layout.root}
              depth={0}
              properties={properties}
              onRemove={(propertyId) => updateLayout(moveProperty(layout, propertyId, null))}
              onSettings={setSelectedPropertyId}
              onNestedKindChange={handleNestedKindChange}
              onNestedRatioChange={handleNestedRatioChange}
              onAddSiblingLayout={handleAddSiblingLayout}
            />
          </section>
        </div>
      </DndContext>

      <p className={`text-sm ${placed.size ? "text-stone-500" : "text-amber-700"}`}>
        {unplaced.length} property chưa được đặt — chúng sẽ không hiện trong Card Detail.
      </p>
      {layoutNotice && <p className="text-sm text-amber-700">{layoutNotice}</p>}
      {saveState.error && <p className="text-sm text-red-600">{saveState.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : "Lưu bố cục"}
        </button>
        <button
          type="button"
          onClick={resetLayout}
          disabled={!dirty || pending}
          className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Bỏ thay đổi
        </button>
        {dirty && <span className="text-xs text-amber-700">Có thay đổi chưa lưu.</span>}
      </div>

    </form>
      {selectedProperty && (
        <aside className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/40 p-5" aria-label="Cài đặt hiển thị property">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-medium text-stone-900">Hiển thị: {selectedProperty.notionPropertyName}</h2>
              <p className="font-mono text-xs text-stone-500">{selectedProperty.notionPropertyType}</p>
            </div>
            <button type="button" onClick={() => setSelectedPropertyId(null)} className="text-sm text-stone-500 hover:text-stone-800">
              Đóng
            </button>
          </div>
          <PropertyDisplayConfigForm galleryId={galleryId} property={selectedProperty} />
        </aside>
      )}
      <TemplatePanel galleryId={galleryId} layout={layout} templates={templates} onApply={applyTemplate} />
    </>
  );
}

function TemplatePanel({
  galleryId,
  layout,
  templates,
  onApply,
}: {
  galleryId: string;
  layout: DetailLayout;
  templates: { id: string; name: string; layout: string }[];
  onApply: (templateId: string) => { message: string | null };
}) {
  const action = saveLayoutTemplate.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveTemplateState, FormData>(action, { error: null });
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="mt-5 grid gap-5 rounded-lg border border-stone-200 p-5 md:grid-cols-2">
      <div>
        <h2 className="mb-1 font-medium text-stone-900">Lưu làm mẫu</h2>
        <p className="mb-3 text-sm text-stone-500">Lưu một bản sao bố cục hiện tại để tái sử dụng ở Gallery khác.</p>
        <form action={formAction} className="flex gap-2">
          <input type="hidden" name="layout" value={JSON.stringify(layout)} />
          <input
            required
            name="name"
            maxLength={100}
            placeholder="Tên mẫu"
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
          />
          <button type="submit" disabled={pending} className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:border-stone-400 disabled:opacity-50">
            {pending ? "Đang lưu…" : "Lưu mẫu"}
          </button>
        </form>
        {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      </div>
      <div>
        <h2 className="mb-1 font-medium text-stone-900">Áp dụng mẫu</h2>
        <p className="mb-3 text-sm text-stone-500">Property được map theo tên; property không khớp sẽ không bị đặt vào layout.</p>
        <div className="flex gap-2">
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600"
          >
            <option value="">Chọn mẫu…</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setMessage(onApply(templateId).message)}
            disabled={!templates.length}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:border-stone-400 disabled:opacity-50"
          >
            Áp dụng
          </button>
        </div>
        {!templates.length && <p className="mt-2 text-xs text-stone-400">Chưa có mẫu bố cục nào.</p>}
        {message && <p className="mt-2 text-sm text-amber-700">{message}</p>}
      </div>
    </section>
  );
}

function PropertyTray({
  properties,
  query,
  onQueryChange,
}: {
  properties: BuilderProperty[];
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  return (
    <aside ref={setNodeRef} className={`rounded-lg border p-4 ${isOver ? "border-emerald-500 bg-emerald-50" : "border-stone-200 bg-white"}`}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-400">Property chưa dùng</p>
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Tìm property…"
        className="mb-3 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
      />
      <div className="flex max-h-[31rem] flex-col gap-2 overflow-y-auto pr-1">
        {properties.length ? (
          properties.map((property) => <DraggableProperty key={property.notionPropertyId} property={property} />)
        ) : (
          <p className="py-4 text-center text-xs text-stone-400">Không còn property phù hợp.</p>
        )}
      </div>
    </aside>
  );
}

function LayoutCanvas({
  node,
  depth,
  properties,
  onRemove,
  onSettings,
  onNestedKindChange,
  onNestedRatioChange,
  onAddSiblingLayout,
  containerId,
}: {
  node: DetailLayoutNode;
  depth: number;
  properties: BuilderProperty[];
  onRemove: (propertyId: string) => void;
  onSettings: (propertyId: string) => void;
  onNestedKindChange: (cellId: string, kind: LayoutKind | "none") => void;
  onNestedRatioChange: (cellId: string, ratio: LayoutRatio) => void;
  onAddSiblingLayout: (containerId: string) => void;
  containerId?: string;
}) {
  const canAddSiblingLayout = node.kind === "stack" && depth === 1 && !!containerId;
  return (
    <div className={canAddSiblingLayout ? "flex flex-col gap-3" : undefined}>
      <div className={`grid gap-3 ${layoutGridClass(node)}`}>
        {node.cells.map((cell, index) => (
          <div key={cell.id} className={cellPlacementClass(node.kind, index)}>
            {cell.kind && cell.cells ? (
              <div className="rounded-lg border border-stone-300 bg-white p-3">
                <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_8rem] xl:items-end">
                  <LayoutKindPicker
                    compact
                    includeNone
                    label="Chia ô"
                    value={cell.kind}
                    onChange={(kind) => onNestedKindChange(cell.id, kind)}
                  />
                  {layoutUsesColumns(cell.kind) && <RatioSelect value={cell.ratio ?? [50, 50]} onChange={(ratio) => onNestedRatioChange(cell.id, ratio)} />}
                </div>
                <LayoutCanvas
                  node={cell as DetailLayoutNode}
                  depth={depth + 1}
                  containerId={cell.id}
                  properties={properties}
                  onRemove={onRemove}
                  onSettings={onSettings}
                  onNestedKindChange={onNestedKindChange}
                  onNestedRatioChange={onNestedRatioChange}
                  onAddSiblingLayout={onAddSiblingLayout}
                />
              </div>
            ) : (
              <CanvasCell
                cell={cell}
                depth={depth}
                isStackSection={node.kind === "stack" && depth === 1}
                properties={properties}
                onRemove={onRemove}
                onSettings={onSettings}
                onNestedKindChange={onNestedKindChange}
              />
            )}
          </div>
        ))}
      </div>
      {canAddSiblingLayout && (
        <button
          type="button"
          onClick={() => onAddSiblingLayout(containerId)}
          disabled={node.cells.length >= MAX_STACK_LAYOUT_CELLS}
          className="self-start rounded-md border border-dashed border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-400"
        >
          + Thêm layout cùng lớp
        </button>
      )}
    </div>
  );
}

function CanvasCell({
  cell,
  depth,
  isStackSection,
  properties,
  onRemove,
  onSettings,
  onNestedKindChange,
}: {
  cell: DetailLayoutCell;
  depth: number;
  isStackSection: boolean;
  properties: BuilderProperty[];
  onRemove: (propertyId: string) => void;
  onSettings: (propertyId: string) => void;
  onNestedKindChange: (cellId: string, kind: LayoutKind | "none") => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${cell.id}` });
  const fields = cell.props.map((propertyId) => properties.find((property) => property.notionPropertyId === propertyId));
  return (
    <div ref={setNodeRef} className={`min-h-32 rounded-lg border p-3 ${isOver ? "border-emerald-500 bg-emerald-50" : "border-stone-300 bg-white"}`}>
      {depth === 0 || isStackSection ? (
        <div className="mb-3">
          <LayoutKindPicker
            compact
            label={isStackSection ? "Kiểu layout" : "Chia nhỏ ô này"}
            value="none"
            options={isStackSection ? ROOT_KIND_OPTIONS : ROOT_KIND_OPTIONS.filter((option) => option.value !== "single")}
            onChange={(kind) => {
              if (kind !== "none") onNestedKindChange(cell.id, kind);
            }}
          />
        </div>
      ) : (
        <div className="mb-3 flex flex-col gap-1">
          <button type="button" disabled className="self-start rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-400">
            Chia tiếp
          </button>
          <p className="text-[11px] text-stone-400">Không thể chia tiếp: đây là layer cuối.</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {fields.map((property, index) =>
          property && !property.isMissing ? (
            <DraggableProperty key={property.notionPropertyId} property={property} onRemove={onRemove} onSettings={onSettings} />
          ) : (
            <MissingPropertyCard key={cell.props[index]} propertyId={cell.props[index]} onRemove={onRemove} />
          ),
        )}
        {!fields.length && <p className="py-6 text-center text-xs text-stone-400">Thả property vào đây</p>}
      </div>
    </div>
  );
}

function DraggableProperty({
  property,
  onRemove,
  onSettings,
}: {
  property: BuilderProperty;
  onRemove?: (propertyId: string) => void;
  onSettings?: (propertyId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `property:${property.notionPropertyId}` });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800 ${isDragging ? "opacity-45" : ""}`}
    >
      <button type="button" aria-label={`Kéo ${property.notionPropertyName}`} className="cursor-grab text-stone-400 active:cursor-grabbing" {...listeners} {...attributes}>
        ⠿
      </button>
      <span className="min-w-0 flex-1 truncate">{property.notionPropertyName}</span>
      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">{property.notionPropertyType}</span>
      {onSettings && <button type="button" onClick={() => onSettings(property.notionPropertyId)} aria-label={`Cài đặt ${property.notionPropertyName}`} className="text-stone-500 hover:text-emerald-700">⚙</button>}
      {onRemove && <button type="button" onClick={() => onRemove(property.notionPropertyId)} aria-label={`Gỡ ${property.notionPropertyName}`} className="text-stone-400 hover:text-red-600">×</button>}
    </div>
  );
}

function MissingPropertyCard({ propertyId, onRemove }: { propertyId: string; onRemove: (propertyId: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-stone-300 bg-stone-50 px-2 py-2 text-xs text-stone-500">
      <span className="min-w-0 flex-1 truncate">Property không còn tồn tại ({propertyId})</span>
      <button type="button" onClick={() => onRemove(propertyId)} className="text-stone-500 hover:text-red-600">Gỡ</button>
    </div>
  );
}

function LayoutKindPicker({
  label,
  value,
  onChange,
  includeNone = false,
  compact = false,
  options = ROOT_KIND_OPTIONS,
}: {
  label: string;
  value: LayoutKind | "none";
  onChange: (kind: LayoutKind | "none") => void;
  includeNone?: boolean;
  compact?: boolean;
  options?: { value: LayoutKind; label: string }[];
}) {
  const choices = includeNone ? [{ value: "none" as const, label: "Gộp thành một ô" }, ...options] : options;
  const selectedChoice = choices.find((choice) => choice.value === value) ?? choices[0]!;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <fieldset className="relative">
      <legend className={`mb-2 font-medium text-stone-500 ${compact ? "text-[11px] uppercase tracking-wide" : "text-xs"}`}>{label}</legend>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-md border bg-white px-2 text-left text-stone-800 transition-colors hover:border-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
          isOpen ? "border-emerald-700" : "border-stone-300"
        }`}
      >
        <LayoutPreview compact kind={selectedChoice.value} selected />
        <span className={`min-w-0 flex-1 truncate font-medium ${compact ? "text-xs" : "text-sm"}`}>{selectedChoice.label}</span>
        <span aria-hidden className="text-stone-400">⌄</span>
      </button>
      {isOpen && (
        <div role="dialog" aria-label={`Chọn ${label}`} className="absolute z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-stone-300 bg-white p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-900">Chọn {label.toLocaleLowerCase("vi")}</p>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">
              Đóng
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {choices.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`min-h-20 rounded-md border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    selected
                      ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                      : "border-stone-300 bg-white text-stone-700 hover:border-stone-500 hover:bg-stone-50"
                  }`}
                >
                  <LayoutPreview kind={option.value} selected={selected} />
                  <span className="mt-2 block text-xs font-medium leading-tight">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function LayoutPreview({ kind, selected, compact = false }: { kind: LayoutKind | "none"; selected: boolean; compact?: boolean }) {
  const cellClass = `rounded-[2px] border ${selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100"}`;
  const frameClass = `grid shrink-0 gap-1 rounded-sm bg-stone-200/70 p-1 ${compact ? "h-7 w-12" : "h-9"}`;

  if (kind === "single" || kind === "none") {
    return <span aria-hidden className={frameClass}><span className={cellClass} /></span>;
  }
  if (kind === "stack") {
    return <span aria-hidden className={`${frameClass} grid-rows-2`}><span className={cellClass} /><span className={cellClass} /></span>;
  }
  if (kind === "two-col") {
    return <span aria-hidden className={`${frameClass} grid-cols-2`}><span className={cellClass} /><span className={cellClass} /></span>;
  }
  if (kind === "two-col-split-left") {
    return (
      <span aria-hidden className={`${frameClass} grid-cols-2 grid-rows-2`}>
        <span className={cellClass} />
        <span className={`${cellClass} col-start-2 row-span-2`} />
        <span className={cellClass} />
      </span>
    );
  }
  return (
    <span aria-hidden className={`${frameClass} grid-cols-2 grid-rows-2`}>
      <span className={`${cellClass} row-span-2`} />
      <span className={cellClass} />
      <span className={cellClass} />
    </span>
  );
}

function RatioSelect({ value, onChange }: { value: LayoutRatio; onChange: (ratio: LayoutRatio) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = RATIO_OPTIONS.find((option) => option.value[0] === value[0] && option.value[1] === value[1]) ?? RATIO_OPTIONS[0]!;

  return (
    <fieldset className="relative">
      <legend className="mb-2 text-xs font-medium text-stone-500">Tỉ lệ cột</legend>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-md border bg-white px-2 text-left text-stone-800 transition-colors hover:border-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
          isOpen ? "border-emerald-700" : "border-stone-300"
        }`}
      >
        <RatioPreview ratio={selected.value} selected />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{selected.label}</span>
        <span aria-hidden className="text-stone-400">⌄</span>
      </button>
      {isOpen && (
        <div role="dialog" aria-label="Chọn tỉ lệ cột" className="absolute z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-stone-300 bg-white p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-900">Chọn tỉ lệ cột</p>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">
              Đóng
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RATIO_OPTIONS.map((option) => {
              const optionSelected = option.value[0] === value[0] && option.value[1] === value[1];
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={optionSelected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`min-h-20 rounded-md border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    optionSelected
                      ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                      : "border-stone-300 bg-white text-stone-700 hover:border-stone-500 hover:bg-stone-50"
                  }`}
                >
                  <RatioPreview ratio={option.value} selected={optionSelected} />
                  <span className="mt-2 block text-xs font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function RatioPreview({ ratio, selected }: { ratio: LayoutRatio; selected: boolean }) {
  const cellClass = `rounded-[2px] border ${selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100"}`;
  return (
    <span aria-hidden className="flex h-7 w-12 shrink-0 gap-1 rounded-sm bg-stone-200/70 p-1">
      <span style={{ flex: ratio[0] }} className={cellClass} />
      <span style={{ flex: ratio[1] }} className={cellClass} />
    </span>
  );
}

function reshapeRoot(root: DetailLayoutNode, kind: LayoutKind): { node: DetailLayoutNode; consolidated: boolean } {
  const prior = root.cells.map((cell) => propertiesInCell(cell));
  const nextCells = Array.from({ length: layoutCellCount(kind) }, (_, index) => ({
    id: `root-${crypto.randomUUID()}`,
    props: index < prior.length ? prior[index] : [],
  }));
  for (let index = nextCells.length; index < prior.length; index += 1) {
    nextCells[nextCells.length - 1].props.push(...prior[index]);
  }
  return {
    node: { kind, ...(layoutUsesColumns(kind) ? { ratio: root.ratio ?? [50, 50] as LayoutRatio } : {}), cells: nextCells },
    consolidated: prior.length > nextCells.length,
  };
}

function updateNestedKind(root: DetailLayoutNode, targetId: string, kind: LayoutKind | "none"): { node: DetailLayoutNode; consolidated: boolean } {
  let consolidated = false;
  const visit = (node: DetailLayoutNode): DetailLayoutNode => ({
    ...node,
    cells: node.cells.map((cell) => {
      if (cell.id === targetId) {
        const properties = propertiesInCell(cell);
        if (kind === "none") return { id: cell.id, props: properties };
        const priorNode: DetailLayoutNode = cell.kind && cell.cells
          ? { kind: cell.kind, ...(cell.ratio ? { ratio: cell.ratio } : {}), cells: cell.cells }
          : { kind: "single", cells: [{ id: cell.id, props: cell.props }] };
        const reshaped = reshapeRoot(priorNode, kind);
        consolidated = reshaped.consolidated;
        return {
          id: cell.id,
          props: [],
          kind: reshaped.node.kind,
          ...(reshaped.node.ratio ? { ratio: reshaped.node.ratio } : {}),
          cells: reshaped.node.cells,
        };
      }
      if (cell.kind && cell.cells) {
        const nested = visit(cell as DetailLayoutNode);
        return { ...cell, cells: nested.cells };
      }
      return cell;
    }),
  });
  return { node: visit(root), consolidated };
}

function updateNestedRatio(root: DetailLayoutNode, targetId: string, ratio: LayoutRatio): DetailLayoutNode {
  const visit = (node: DetailLayoutNode): DetailLayoutNode => ({
    ...node,
    cells: node.cells.map((cell) => {
      if (cell.id === targetId && cell.kind) return { ...cell, ratio };
      if (cell.kind && cell.cells) {
        const nested = visit(cell as DetailLayoutNode);
        return { ...cell, cells: nested.cells };
      }
      return cell;
    }),
  });
  return visit(root);
}

function addSiblingLayout(root: DetailLayoutNode, targetId: string): DetailLayoutNode {
  const visit = (node: DetailLayoutNode): DetailLayoutNode => ({
    ...node,
    cells: node.cells.map((cell) => {
      if (cell.id === targetId && cell.kind === "stack" && cell.cells && cell.cells.length < MAX_STACK_LAYOUT_CELLS) {
        return { ...cell, cells: [...cell.cells, { id: `section-${crypto.randomUUID()}`, props: [] }] };
      }
      if (cell.kind && cell.cells) {
        const nested = visit(cell as DetailLayoutNode);
        return { ...cell, cells: nested.cells };
      }
      return cell;
    }),
  });
  return visit(root);
}

function moveProperty(layout: DetailLayout, propertyId: string, targetCellId: string | null, beforeId?: string | null): DetailLayout {
  const without = removeProperty(layout.root, propertyId);
  if (!targetCellId) return { ...layout, root: without };
  return { ...layout, root: insertProperty(without, targetCellId, propertyId, beforeId) };
}

function removeProperty(node: DetailLayoutNode, propertyId: string): DetailLayoutNode {
  return {
    ...node,
    cells: node.cells.map((cell) => {
      if (cell.kind && cell.cells) return { ...cell, cells: removeProperty(cell as DetailLayoutNode, propertyId).cells };
      return { ...cell, props: cell.props.filter((id) => id !== propertyId) };
    }),
  };
}

function insertProperty(node: DetailLayoutNode, targetCellId: string, propertyId: string, beforeId?: string | null): DetailLayoutNode {
  return {
    ...node,
    cells: node.cells.map((cell) => {
      if (cell.kind && cell.cells) return { ...cell, cells: insertProperty(cell as DetailLayoutNode, targetCellId, propertyId, beforeId).cells };
      if (cell.id !== targetCellId) return cell;
      const index = beforeId ? cell.props.indexOf(beforeId) : -1;
      const props = [...cell.props];
      props.splice(index < 0 ? props.length : index, 0, propertyId);
      return { ...cell, props };
    }),
  };
}

function findPropertyCell(node: DetailLayoutNode, propertyId: string): string | null {
  for (const cell of node.cells) {
    if (cell.props.includes(propertyId)) return cell.id;
    if (cell.kind && cell.cells) {
      const found = findPropertyCell(cell as DetailLayoutNode, propertyId);
      if (found) return found;
    }
  }
  return null;
}

function propertiesInCell(cell: DetailLayoutCell): string[] {
  if (!cell.kind || !cell.cells) return [...cell.props];
  return cell.cells.flatMap(propertiesInCell);
}

function layoutGridClass(node: DetailLayoutNode) {
  const ratio = node.ratio?.join(":") ?? "50:50";
  if (node.kind === "single" || node.kind === "stack") return "grid-cols-1";
  const ratioClass: Record<string, string> = {
    "50:50": "md:grid-cols-2",
    "60:40": "md:grid-cols-[3fr_2fr]",
    "40:60": "md:grid-cols-[2fr_3fr]",
    "70:30": "md:grid-cols-[7fr_3fr]",
    "30:70": "md:grid-cols-[3fr_7fr]",
  };
  return `grid-cols-1 ${ratioClass[ratio] ?? ratioClass["50:50"]}`;
}

function cellPlacementClass(kind: LayoutKind, index: number) {
  if (kind === "two-col-split-left" && index === 2) return "md:col-start-2 md:row-span-2";
  if (kind === "two-col-split-right" && index === 0) return "md:row-span-2";
  return "";
}
