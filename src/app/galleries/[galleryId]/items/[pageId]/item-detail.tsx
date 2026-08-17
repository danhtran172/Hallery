"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { getEditableValue } from "@/lib/notion-schema";
import { formatDuration, type DisplayConfig } from "@/lib/display-config";
import type { DetailLayout, DetailLayoutCell, DetailLayoutNode } from "@/lib/detail-layout";
import { saveItem, type SaveItemState } from "./actions";

export type FieldData = {
  propertyId: string;
  name: string;
  type: string;
  value: PageObjectResponse["properties"][string];
  editable: boolean;
  readonly: boolean;
  options?: string[];
  displayConfig: DisplayConfig;
};

export function ItemDetail({
  galleryId,
  pageId,
  fields,
  layout,
  notionUrl,
}: {
  galleryId: string;
  pageId: string;
  fields: FieldData[];
  layout: DetailLayout;
  notionUrl: string;
}) {
  const [editing, setEditing] = useState(false);
  const action = saveItem.bind(null, galleryId, pageId);
  const [state, formAction, pending] = useActionState<SaveItemState, FormData>(action, { error: null });

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setEditing(false);
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
        >
          {editing ? "Huỷ" : "Sửa"}
        </button>
        <a href={notionUrl} target="_blank" rel="noreferrer" className="text-xs text-stone-400 hover:underline">
          Mở trong Notion ↗
        </a>
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-col gap-4">
          <DetailLayoutRenderer fields={fields} layout={layout} editing />
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </form>
      ) : (
        <DetailLayoutRenderer fields={fields} layout={layout} editing={false} />
      )}
    </div>
  );
}

/** Shared tree renderer for Card Detail and inline edit mode. */
function DetailLayoutRenderer({
  fields,
  layout,
  editing,
}: {
  fields: FieldData[];
  layout: DetailLayout;
  editing: boolean;
}) {
  const fieldsById = new Map(fields.map((field) => [field.propertyId, field]));
  const placedFields = [...fieldsById.values()].filter((field) => containsProperty(layout.root, field.propertyId));

  if (!placedFields.length) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
        Chưa có property nào trong layout này. Vào Cài đặt bố cục để thêm field vào Card Detail.
      </p>
    );
  }

  return <LayoutNodeView node={layout.root} fieldsById={fieldsById} editing={editing} />;
}

function LayoutNodeView({
  node,
  fieldsById,
  editing,
}: {
  node: DetailLayoutNode;
  fieldsById: Map<string, FieldData>;
  editing: boolean;
}) {
  return (
    <div className={`grid gap-4 ${layoutGridClass(node)}`}>
      {node.cells.map((cell, index) => (
        <div key={cell.id} className={cellPlacementClass(node.kind, index)}>
          <LayoutCellView cell={cell} fieldsById={fieldsById} editing={editing} />
        </div>
      ))}
    </div>
  );
}

function LayoutCellView({
  cell,
  fieldsById,
  editing,
}: {
  cell: DetailLayoutCell;
  fieldsById: Map<string, FieldData>;
  editing: boolean;
}) {
  if (cell.kind && cell.cells) {
    return <LayoutNodeView node={cell as DetailLayoutNode} fieldsById={fieldsById} editing={editing} />;
  }

  const fields = cell.props.map((propertyId) => fieldsById.get(propertyId)).filter((field): field is FieldData => !!field);
  if (!fields.length) return <div className="min-h-20 rounded-lg border border-dashed border-stone-200" />;

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      {fields.map((field, index) => (
        <div key={field.propertyId} className={index ? "border-t border-stone-100" : ""}>
          {editing ? (
            <div className="p-4"><EditField field={field} /></div>
          ) : (
            <div className="grid grid-cols-3 gap-3 px-4 py-3">
              <div className="text-sm text-stone-500">{field.name}</div>
              <div className="col-span-2 text-sm text-stone-800">
                <PropertyValue value={field.value} displayConfig={field.displayConfig} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function containsProperty(node: DetailLayoutNode, propertyId: string): boolean {
  return node.cells.some((cell) =>
    cell.props.includes(propertyId) || (cell.kind && cell.cells ? containsProperty(cell as DetailLayoutNode, propertyId) : false),
  );
}

function layoutGridClass(node: DetailLayoutNode) {
  const ratio = node.ratio?.join(":") ?? "50:50";
  if (node.kind === "single") return "grid-cols-1";
  if (node.kind === "stack") return "grid-cols-1";
  const ratioClass: Record<string, string> = {
    "50:50": "md:grid-cols-2",
    "60:40": "md:grid-cols-[3fr_2fr]",
    "40:60": "md:grid-cols-[2fr_3fr]",
    "70:30": "md:grid-cols-[7fr_3fr]",
    "30:70": "md:grid-cols-[3fr_7fr]",
  };
  return `grid-cols-1 ${ratioClass[ratio] ?? ratioClass["50:50"]}`;
}

function cellPlacementClass(kind: DetailLayoutNode["kind"], index: number) {
  if (kind === "two-col-split-left") {
    if (index === 2) return "md:col-start-2 md:row-span-2";
  }
  if (kind === "two-col-split-right" && index === 0) return "md:row-span-2";
  return "";
}

function EditField({ field }: { field: FieldData }) {
  const fieldName = `field:${field.type}:${field.name}`;

  if (field.readonly) {
    return (
      <FieldRow label={field.name} hint="Chỉ đọc — Notion không cho sửa qua API">
        <PropertyValue value={field.value} displayConfig={field.displayConfig} />
      </FieldRow>
    );
  }

  if (!field.editable) {
    return (
      <FieldRow label={field.name} hint="Chưa hỗ trợ sửa trong Hallery">
        <PropertyValue value={field.value} displayConfig={field.displayConfig} />
      </FieldRow>
    );
  }

  const defaultValue = getEditableValue(field.value);

  if (field.type === "number" && field.displayConfig.kind === "duration") {
    return <DurationField fieldName={fieldName} label={field.name} totalMinutes={Number(defaultValue) || 0} />;
  }

  switch (field.type) {
    case "rich_text":
      return (
        <FieldRow label={field.name}>
          <textarea
            name={fieldName}
            defaultValue={String(defaultValue)}
            rows={3}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
          />
        </FieldRow>
      );
    case "checkbox":
      return (
        <FieldRow label={field.name}>
          <input type="checkbox" name={fieldName} defaultChecked={Boolean(defaultValue)} className="h-4 w-4" />
        </FieldRow>
      );
    case "number":
      return (
        <FieldRow label={field.name}>
          <input
            type="number"
            name={fieldName}
            defaultValue={String(defaultValue)}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
          />
        </FieldRow>
      );
    case "date":
      return (
        <FieldRow label={field.name}>
          <input
            type="date"
            name={fieldName}
            defaultValue={String(defaultValue)}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
          />
        </FieldRow>
      );
    case "select":
    case "status":
      return (
        <SelectField
          fieldName={fieldName}
          label={field.name}
          options={field.options ?? []}
          currentValue={String(defaultValue)}
        />
      );
    case "multi_select": {
      const current =
        field.value.type === "multi_select" ? field.value.multi_select.map((o) => o.name) : [];
      return (
        <MultiSelectField
          fieldName={fieldName}
          label={field.name}
          options={field.options ?? []}
          currentValues={current}
        />
      );
    }
    default:
      return (
        <FieldRow label={field.name}>
          <input
            type={field.type === "url" ? "url" : field.type === "email" ? "email" : "text"}
            name={fieldName}
            defaultValue={String(defaultValue)}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
          />
        </FieldRow>
      );
  }
}

function DurationField({
  fieldName,
  label,
  totalMinutes,
}: {
  fieldName: string;
  label: string;
  totalMinutes: number;
}) {
  const [hours, setHours] = useState(Math.floor(totalMinutes / 60));
  const [minutes, setMinutes] = useState(totalMinutes % 60);

  return (
    <FieldRow label={label} hint={`Lưu xuống Notion dưới dạng tổng phút (${formatDuration(hours * 60 + minutes)})`}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value) || 0)}
          className="w-20 rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
        />
        <span className="text-sm text-stone-500">giờ</span>
        <input
          type="number"
          min={0}
          max={59}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value) || 0)}
          className="w-20 rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
        />
        <span className="text-sm text-stone-500">phút</span>
      </div>
      <input type="hidden" name={fieldName} value={hours * 60 + minutes} />
    </FieldRow>
  );
}

const CUSTOM = "__custom__";

function SelectField({
  fieldName,
  label,
  options,
  currentValue,
}: {
  fieldName: string;
  label: string;
  options: string[];
  currentValue: string;
}) {
  const isKnown = currentValue === "" || options.includes(currentValue);
  const [mode, setMode] = useState<"existing" | "custom">(isKnown ? "existing" : "custom");
  const [customValue, setCustomValue] = useState(isKnown ? "" : currentValue);

  return (
    <FieldRow label={label}>
      {mode === "existing" ? (
        <select
          name={fieldName}
          defaultValue={currentValue}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setMode("custom");
          }}
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
        >
          <option value="">— Trống —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          <option value={CUSTOM}>+ Option mới…</option>
        </select>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            name={fieldName}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Tên option mới"
            autoFocus
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
          />
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setMode("existing")}
              className="shrink-0 text-xs text-stone-500 hover:underline"
            >
              Chọn có sẵn
            </button>
          )}
        </div>
      )}
    </FieldRow>
  );
}

function MultiSelectField({
  fieldName,
  label,
  options,
  currentValues,
}: {
  fieldName: string;
  label: string;
  options: string[];
  currentValues: string[];
}) {
  const [selected, setSelected] = useState<string[]>(currentValues);
  const [customValue, setCustomValue] = useState("");
  const remaining = options.filter((o) => !selected.includes(o));

  function addValue(raw: string) {
    const value = raw.trim();
    if (value && !selected.includes(value)) setSelected((s) => [...s, value]);
  }

  return (
    <FieldRow label={label}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {selected.length === 0 && <span className="text-xs text-stone-400">Chưa chọn gì</span>}
        {selected.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
          >
            {v}
            <button
              type="button"
              onClick={() => setSelected((s) => s.filter((x) => x !== v))}
              className="text-stone-400 hover:text-stone-700"
              aria-label={`Bỏ ${v}`}
            >
              ×
            </button>
            <input type="hidden" name={fieldName} value={v} />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {remaining.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addValue(e.target.value);
            }}
            className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-emerald-600"
          >
            <option value="">+ Thêm từ option có sẵn…</option>
            {remaining.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue(customValue);
              setCustomValue("");
            }
          }}
          placeholder="Gõ tên mới rồi Enter"
          className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
        />
      </div>
    </FieldRow>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-stone-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}
