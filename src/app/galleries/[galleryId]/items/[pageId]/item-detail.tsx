"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { getEditableValue } from "@/lib/notion-schema";
import { formatDuration, type DisplayConfig } from "@/lib/display-config";
import { saveItem, type SaveItemState } from "./actions";

export type FieldData = {
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
  notionUrl,
}: {
  galleryId: string;
  pageId: string;
  fields: FieldData[];
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
        <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-stone-200 p-5">
          {fields.map((field) => (
            <EditField key={field.name} field={field} />
          ))}
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
        <dl className="flex flex-col divide-y divide-stone-100 rounded-lg border border-stone-200">
          {fields.map((field) => (
            <div key={field.name} className="grid grid-cols-3 gap-3 px-4 py-3">
              <dt className="text-sm text-stone-500">{field.name}</dt>
              <dd className="col-span-2 text-sm text-stone-800">
                <PropertyValue value={field.value} displayConfig={field.displayConfig} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
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
