"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createItem, type CreateItemState } from "@/app/galleries/[galleryId]/create-item-actions";
import { ImageDropZone } from "@/components/image-drop-zone";
import { createFieldName } from "@/lib/create-form";

export type CreateFormField = {
  propertyId: string;
  name: string;
  /** What the reader sees: the Hallery rename when there is one. */
  label: string;
  type: string;
  /** Choices for select-like fields. */
  options?: string[];
  required: boolean;
  /** Already resolved from the field's default mode, so the input just uses it. */
  initialValue: string;
};

/**
 * Quick-entry form for adding an item, opened from the gallery.
 *
 * A popup rather than a page: adding an item is meant to be a detour of a few seconds, and
 * landing back on the grid with the new card already there is the point. Only fields the
 * gallery's form layout names appear, in the columns it arranged them into.
 */
export function CreateItemPopup({
  galleryId,
  fields,
  columns,
  cover,
}: {
  galleryId: string;
  fields: CreateFormField[];
  columns: 1 | 2;
  /** Present when the form's layout includes a cover; null when it does not. */
  cover: { ratio: string; round: boolean; targetLabel: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const action = createItem.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<CreateItemState, FormData>(action, { error: null });
  const wrapRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  // Close once the write lands, and refresh so the new card is on the grid behind it.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setOpen(false);
      setNotice("Đã thêm vào Notion");
      router.refresh();
      const timer = window.setTimeout(() => setNotice(null), 2500);
      wasPending.current = pending;
      return () => window.clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending, state.error, router]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="btn btn-primary"
      >
        + Thêm item
      </button>
      {notice && (
        <span role="status" className="absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-brand">
          ✓ {notice}
        </span>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Thêm item"
          className="popover fixed inset-x-4 top-20 z-40 max-h-[calc(100vh-6rem)] overflow-y-auto p-4 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-1 sm:w-[28rem]"
        >
          {fields.length === 0 && !cover ? (
            <div className="flex flex-col gap-3 text-sm text-muted">
              <p>Form chưa có field nào.</p>
              <a href={`/galleries/${galleryId}/settings/card`} className="link self-start">
                Vào Bố cục card → Form thêm để chọn field
              </a>
            </div>
          ) : (
            <form action={formAction} className="flex flex-col gap-3">
              {cover && (
                <div>
                  <ImageDropZone name="coverImage" ratio={cover.ratio} round={cover.round} active={open} />
                  <p className="mt-1 text-[11px] text-faint">Lưu vào: {cover.targetLabel}</p>
                </div>
              )}

              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {fields.map((field, index) => (
                  <FormField key={field.propertyId} field={field} autoFocus={index === 0 && !cover} />
                ))}
              </div>

              {state.error && (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                  {state.error}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button type="submit" disabled={pending} className="btn btn-primary">
                  {pending ? "Đang thêm…" : "Thêm vào Notion"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
                  Huỷ
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function FormField({ field, autoFocus }: { field: CreateFormField; autoFocus?: boolean }) {
  const name = createFieldName(field.type, field.propertyId);
  const id = `create-${field.propertyId}`;
  const label = (
    <label htmlFor={id} className="field-label">
      {field.label}
      {field.required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name={name} defaultChecked={field.initialValue === "true"} className="size-4 accent-brand" />
        {field.label}
      </label>
    );
  }

  if (field.type === "select" || field.type === "status") {
    return (
      <div>
        {label}
        <select id={id} name={name} defaultValue={field.initialValue} required={field.required} className="input input-sm">
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "multi_select") {
    return (
      <div>
        <span className="field-label">
          {field.label}
          {field.required && <span className="ml-0.5 text-danger">*</span>}
        </span>
        <MultiSelectInput name={name} options={field.options ?? []} initial={field.initialValue} />
      </div>
    );
  }

  if (field.type === "rich_text") {
    return (
      <div>
        {label}
        <textarea
          id={id}
          name={name}
          defaultValue={field.initialValue}
          required={field.required}
          rows={2}
          className="input text-xs"
        />
      </div>
    );
  }

  const inputType =
    field.type === "number"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "email"
          ? "email"
          : field.type === "url"
            ? "url"
            : field.type === "phone_number"
              ? "tel"
              : "text";

  return (
    <div>
      {label}
      <input
        id={id}
        type={inputType}
        name={name}
        defaultValue={field.initialValue}
        // step="any" so 3.5 is a number, not a validation error.
        {...(inputType === "number" ? { step: "any", inputMode: "decimal" as const } : {})}
        // The server enforces this too; here it just stops the trip being wasted.
        required={field.required}
        autoFocus={autoFocus}
        className="input input-sm"
      />
    </div>
  );
}

function MultiSelectInput({ name, options, initial }: { name: string; options: string[]; initial: string }) {
  const [chosen, setChosen] = useState<string[]>(
    initial ? initial.split(",").map((v) => v.trim()).filter(Boolean) : [],
  );

  const toggle = (option: string) =>
    setChosen((current) => (current.includes(option) ? current.filter((v) => v !== option) : [...current, option]));

  return (
    <div className="rounded-md border border-line-strong p-1">
      {chosen.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {options.length === 0 && <span className="px-1 text-[11px] text-faint">Chưa có option nào.</span>}
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={chosen.includes(option)}
            onClick={() => toggle(option)}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              chosen.includes(option) ? "bg-brand text-white" : "bg-stone-100 text-ink-soft hover:bg-stone-200"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
