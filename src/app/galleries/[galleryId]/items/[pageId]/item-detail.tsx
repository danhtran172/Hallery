"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { getEditableValue } from "@/lib/notion-schema";
import { formatDuration, type DisplayConfig } from "@/lib/display-config";
import type { CardEligibleProperty, ResolvedCardLayout, ResolvedGrid } from "@/lib/card-layout";
import { DATE_END_SUFFIX, FORM_FIELD_MANIFEST } from "@/lib/notion-write";
import type { RenderContext } from "@/lib/property-render";
import { saveItem, type SaveItemState } from "./actions";

/** The detail carries no cover, so only its single frame is ever drawn. */
type DetailLayout = ResolvedCardLayout<CardEligibleProperty>;

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

const labelOf = (field: FieldData) => field.displayConfig.nameOverride?.trim() || field.name;

export function ItemDetail({
  galleryId,
  pageId,
  titleField,
  fields,
  layout,
  coverUrl,
  coverRatio,
  coverRound,
  notionUrl,
  renderContext,
}: {
  galleryId: string;
  pageId: string;
  /** The page title, editable alongside the rest. */
  titleField: FieldData | null;
  fields: FieldData[];
  layout: DetailLayout;
  coverUrl: string | null;
  coverRatio: string;
  coverRound: boolean;
  notionUrl: string;
  renderContext: RenderContext;
}) {
  const [editing, setEditing] = useState(false);
  // A fresh form per edit session, so "Huỷ" really discards what was typed.
  const [session, setSession] = useState(0);
  const action = saveItem.bind(null, galleryId, pageId);
  const [state, formAction, pending] = useActionState<SaveItemState, FormData>(action, { error: null });

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) setEditing(false);
    wasPending.current = pending;
  }, [pending, state.error]);

  const startEditing = () => {
    setSession((value) => value + 1);
    setEditing(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="submit" form={`item-edit-${pageId}`} disabled={pending} className="btn btn-primary">
              {pending ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className="btn btn-secondary">
              Huỷ
            </button>
          </>
        ) : (
          <button type="button" onClick={startEditing} className="btn btn-primary">
            Sửa
          </button>
        )}
        <a href={notionUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
          Mở trong Notion ↗
        </a>
        {!editing && state.savedAt && !state.error && <span className="text-xs text-brand">Đã lưu</span>}
      </div>

      {editing ? (
        <form key={session} id={`item-edit-${pageId}`} action={formAction} className="flex flex-col gap-5">
          {titleField && (
            <div>
              <input type="hidden" name={FORM_FIELD_MANIFEST} value={fieldNameOf(titleField)} />
              <label className="field-label" htmlFor={`title-${pageId}`}>
                Tiêu đề
              </label>
              <input
                id={`title-${pageId}`}
                name={fieldNameOf(titleField)}
                defaultValue={String(getEditableValue(titleField.value))}
                className="input h-10 text-base font-medium"
              />
              <RichTextWarning value={titleField.value} />
            </div>
          )}
          <DetailLayoutRenderer
            fields={fields}
            layout={layout}
            coverUrl={coverUrl}
            coverRatio={coverRatio}
            coverRound={coverRound}
            renderContext={renderContext}
            editing
          />
          {state.error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className="btn btn-secondary">
              Huỷ
            </button>
          </div>
        </form>
      ) : (
        <DetailLayoutRenderer
          fields={fields}
          layout={layout}
          coverUrl={coverUrl}
          coverRatio={coverRatio}
          coverRound={coverRound}
          renderContext={renderContext}
          editing={false}
        />
      )}
    </div>
  );
}

/**
 * Shared renderer for Card Detail and inline edit mode.
 *
 * Lays the cover out the way the card does — above, beside, or absent — so the detail is
 * the same arrangement at page size rather than a second design.
 */
function DetailLayoutRenderer({
  fields,
  layout,
  coverUrl,
  coverRatio,
  coverRound,
  renderContext,
  editing,
}: {
  fields: FieldData[];
  layout: DetailLayout;
  coverUrl: string | null;
  coverRatio: string;
  coverRound: boolean;
  renderContext: RenderContext;
  editing: boolean;
}) {
  const fieldsById = new Map(fields.map((field) => [field.propertyId, field]));
  const hasFields = Object.values(layout.regions).some((grid) =>
    grid.boxes.some((box) => box.fields.some((f) => !f.isTitle && f.property)),
  );

  if (!hasFields && layout.cover === "none") {
    return (
      <p className="empty-state">
        Chưa có property nào trong bố cục này. Vào Bố cục card → Card Detail để thêm field.
      </p>
    );
  }

  const cover =
    layout.cover === "none" ? null : (
      <div
        // self-start matters: a flex child stretches to the row by default, and that
        // definite height overrides aspect-ratio, squashing the crop out of shape.
        className={`max-w-full shrink-0 self-start overflow-hidden bg-stone-100 bg-cover bg-center ${
          coverRound ? "rounded-full" : "rounded-xl"
        }`}
        style={{
          aspectRatio: coverRatio,
          width: layout.sideBySide ? `${layout.ratio[0]}%` : "100%",
          ...(coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : {}),
        }}
      />
    );

  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {Object.entries(layout.regions).map(([id, grid]) => (
        <DetailGridView
          key={id}
          grid={grid}
          fieldsById={fieldsById}
          editing={editing}
          renderContext={renderContext}
        />
      ))}
    </div>
  );

  if (layout.sideBySide) {
    return (
      <div className={`flex flex-col gap-5 sm:flex-row ${layout.cover === "right" ? "sm:flex-row-reverse" : ""}`}>
        {cover}
        {content}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {cover}
      {content}
    </div>
  );
}

function DetailGridView({
  grid,
  fieldsById,
  editing,
  renderContext,
}: {
  grid: ResolvedGrid<CardEligibleProperty>;
  fieldsById: Map<string, FieldData>;
  editing: boolean;
  renderContext: RenderContext;
}) {
  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        alignContent: grid.align ?? "start",
      }}
    >
      {grid.boxes.map((box) => {
        // A folded box takes no track; the neighbour it merged into spans over it.
        if (box.merged) return null;

        const boxFields = box.fields
          .map((resolved) => (resolved.property ? fieldsById.get(resolved.property.notionPropertyId) : undefined))
          .filter((field): field is FieldData => Boolean(field));

        return (
          <div
            key={box.id}
            className="min-w-0"
            style={{
              gridColumn: box.colSpan > 1 ? `span ${box.colSpan}` : undefined,
              gridRow: box.rowSpan > 1 ? `span ${box.rowSpan}` : undefined,
            }}
          >
            {boxFields.length === 0 ? (
              <div className="h-full min-h-20 rounded-xl border border-dashed border-line" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
                {boxFields.map((field, index) => (
                  <div key={field.propertyId} className={index ? "border-t border-line" : ""}>
                    {editing ? (
                      <div className="p-4">
                        <EditField field={field} renderContext={renderContext} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-3">
                        <div className="min-w-0 text-sm break-words text-muted">{labelOf(field)}</div>
                        <div className="min-w-0 text-sm break-words text-ink sm:col-span-2">
                          <PropertyValue value={field.value} displayConfig={field.displayConfig} context={renderContext} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** `field:<type>:<property id>` — ids, so a rename in Notion mid-edit still saves. */
const fieldNameOf = (field: FieldData) => `field:${field.type}:${field.propertyId}`;

function EditField({ field, renderContext }: { field: FieldData; renderContext: RenderContext }) {
  const fieldName = fieldNameOf(field);
  const label = labelOf(field);

  if (field.readonly || !field.editable) {
    return (
      <FieldRow
        label={label}
        hint={field.readonly ? "Chỉ đọc — Notion không cho sửa kiểu này qua API" : "Chưa sửa được kiểu này trong Hallery"}
      >
        <div className="text-sm text-ink">
          <PropertyValue value={field.value} displayConfig={field.displayConfig} context={renderContext} />
        </div>
      </FieldRow>
    );
  }

  const defaultValue = getEditableValue(field.value);
  const manifest = <input type="hidden" name={FORM_FIELD_MANIFEST} value={fieldName} />;
  const inputId = `edit-${field.propertyId}`;

  if (field.type === "number" && field.displayConfig.kind === "duration") {
    return (
      <>
        {manifest}
        <DurationField fieldName={fieldName} label={label} totalMinutes={Number(defaultValue) || 0} />
      </>
    );
  }

  switch (field.type) {
    case "rich_text":
      return (
        <FieldRow label={label} htmlFor={inputId}>
          {manifest}
          <textarea id={inputId} name={fieldName} defaultValue={String(defaultValue)} rows={3} className="input" />
          <RichTextWarning value={field.value} />
        </FieldRow>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          {manifest}
          <input type="checkbox" name={fieldName} defaultChecked={Boolean(defaultValue)} className="size-4 accent-brand" />
          {label}
        </label>
      );
    case "number":
      return (
        <FieldRow label={label} htmlFor={inputId}>
          {manifest}
          {/* step="any": the default step of 1 made the browser refuse 3.5 as "invalid". */}
          <input
            id={inputId}
            type="number"
            step="any"
            inputMode="decimal"
            name={fieldName}
            defaultValue={String(defaultValue)}
            className="input"
          />
        </FieldRow>
      );
    case "date":
      return (
        <>
          {manifest}
          <DateField
            fieldName={fieldName}
            label={label}
            value={field.value.type === "date" ? field.value.date : null}
          />
        </>
      );
    case "select":
    case "status":
      return (
        <>
          {manifest}
          <SelectField
            fieldName={fieldName}
            label={label}
            options={field.options ?? []}
            currentValue={String(defaultValue)}
            allowCustom={field.type === "select"}
          />
        </>
      );
    case "multi_select": {
      const current = field.value.type === "multi_select" ? field.value.multi_select.map((o) => o.name) : [];
      return (
        <>
          {manifest}
          <MultiSelectField fieldName={fieldName} label={label} options={field.options ?? []} currentValues={current} />
        </>
      );
    }
    default:
      return (
        <FieldRow label={label} htmlFor={inputId}>
          {manifest}
          <input
            id={inputId}
            type={field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "phone_number" ? "tel" : "text"}
            name={fieldName}
            defaultValue={String(defaultValue)}
            className="input"
          />
        </FieldRow>
      );
  }
}

/** Editing text as plain text drops Notion formatting; say so before it happens. */
function RichTextWarning({ value }: { value: FieldData["value"] }) {
  const parts = value.type === "rich_text" ? value.rich_text : value.type === "title" ? value.title : [];
  const formatted = parts.some(
    (part) =>
      part.type !== "text" ||
      part.href ||
      part.annotations.bold ||
      part.annotations.italic ||
      part.annotations.code ||
      part.annotations.strikethrough ||
      part.annotations.underline ||
      part.annotations.color !== "default",
  );
  if (!formatted) return null;
  return (
    <span className="field-hint">
      Có định dạng (đậm, link, mention…). Chỉ khi bạn sửa nội dung, định dạng mới bị thay bằng chữ thường.
    </span>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Local calendar date and clock time of a Notion date string. */
function splitDate(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso, time: "" };
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return { date: iso.slice(0, 10), time: "" };
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

/** A date plus an optional time, as Notion wants it: with this browser's UTC offset. */
function joinDate(date: string, time: string): string {
  if (!date) return "";
  if (!time) return date;
  const local = new Date(`${date}T${time}:00`);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date}T${time}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/**
 * A date with its time and end kept intact. The old editor showed only the start day, so
 * saving any field rewrote "10/09 08:00 → 12/09" as a bare "10/09".
 */
function DateField({
  fieldName,
  label,
  value,
}: {
  fieldName: string;
  label: string;
  value: { start: string; end: string | null } | null;
}) {
  const initialStart = splitDate(value?.start);
  const initialEnd = splitDate(value?.end);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [withTime, setWithTime] = useState(Boolean(initialStart.time));
  const [withEnd, setWithEnd] = useState(Boolean(value?.end));

  return (
    <FieldRow label={label}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label={`${label} — ngày`}
            value={start.date}
            onChange={(event) => setStart({ ...start, date: event.target.value })}
            className="input w-auto"
          />
          {withTime && (
            <input
              type="time"
              aria-label={`${label} — giờ`}
              value={start.time}
              onChange={(event) => setStart({ ...start, time: event.target.value })}
              className="input w-auto"
            />
          )}
          {withEnd && (
            <>
              <span className="text-sm text-muted">→</span>
              <input
                type="date"
                aria-label={`${label} — ngày kết thúc`}
                value={end.date}
                onChange={(event) => setEnd({ ...end, date: event.target.value })}
                className="input w-auto"
              />
              {withTime && (
                <input
                  type="time"
                  aria-label={`${label} — giờ kết thúc`}
                  value={end.time}
                  onChange={(event) => setEnd({ ...end, time: event.target.value })}
                  className="input w-auto"
                />
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={withTime} onChange={(event) => setWithTime(event.target.checked)} className="accent-brand" />
            Có giờ
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={withEnd} onChange={(event) => setWithEnd(event.target.checked)} className="accent-brand" />
            Có ngày kết thúc
          </label>
          {start.date && (
            <button
              type="button"
              onClick={() => {
                setStart({ date: "", time: "" });
                setEnd({ date: "", time: "" });
              }}
              className="link text-xs"
            >
              Xoá ngày
            </button>
          )}
        </div>
      </div>
      <input type="hidden" name={fieldName} value={joinDate(start.date, withTime ? start.time : "")} />
      <input
        type="hidden"
        name={`${fieldName}${DATE_END_SUFFIX}`}
        value={withEnd && start.date ? joinDate(end.date, withTime ? end.time : "") : ""}
      />
    </FieldRow>
  );
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
          aria-label={`${label} — giờ`}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value) || 0)}
          className="input w-20"
        />
        <span className="text-sm text-muted">giờ</span>
        <input
          type="number"
          min={0}
          max={59}
          aria-label={`${label} — phút`}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value) || 0)}
          className="input w-20"
        />
        <span className="text-sm text-muted">phút</span>
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
  allowCustom,
}: {
  fieldName: string;
  label: string;
  options: string[];
  currentValue: string;
  /** Status options can only be chosen; Notion refuses a new one from a page write. */
  allowCustom: boolean;
}) {
  const isKnown = currentValue === "" || options.includes(currentValue);
  const [mode, setMode] = useState<"existing" | "custom">(isKnown ? "existing" : "custom");
  const [customValue, setCustomValue] = useState(isKnown ? "" : currentValue);

  return (
    <FieldRow label={label}>
      {mode === "existing" ? (
        <select
          name={fieldName}
          aria-label={label}
          defaultValue={currentValue}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setMode("custom");
          }}
          className="input"
        >
          <option value="">— Trống —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {allowCustom && <option value={CUSTOM}>+ Option mới…</option>}
        </select>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            name={fieldName}
            aria-label={label}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Tên option mới"
            autoFocus
            className="input"
          />
          {options.length > 0 && (
            <button type="button" onClick={() => setMode("existing")} className="btn btn-ghost btn-sm">
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
        {selected.length === 0 && <span className="text-xs text-faint">Chưa chọn gì</span>}
        {selected.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-ink-soft">
            {v}
            <button
              type="button"
              onClick={() => setSelected((s) => s.filter((x) => x !== v))}
              className="text-faint hover:text-ink"
              aria-label={`Bỏ ${v}`}
            >
              ×
            </button>
            <input type="hidden" name={fieldName} value={v} />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {remaining.length > 0 && (
          <select
            value=""
            aria-label={`Thêm vào ${label}`}
            onChange={(e) => {
              if (e.target.value) addValue(e.target.value);
            }}
            className="input w-auto"
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
          aria-label={`Option mới cho ${label}`}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue(customValue);
              setCustomValue("");
            }
          }}
          placeholder="Gõ tên mới rồi Enter"
          className="input min-w-40 flex-1"
        />
      </div>
    </FieldRow>
  );
}

function FieldRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="field-label">
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
