"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createItem, type CreateItemState } from "@/app/galleries/[galleryId]/create-item-actions";
import { ImageDropZone } from "@/components/image-drop-zone";

export type CreateFormField = {
  propertyId: string;
  name: string;
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
  cover: { ratio: string; targetLabel: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const action = createItem.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<CreateItemState, FormData>(action, { error: null });
  const wrapRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  // Close once the write lands, and refresh so the new card is on the grid behind it.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setOpen(false);
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state.error, router]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
      >
        + Thêm item
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[26rem] rounded-lg border border-stone-200 bg-white p-4 shadow-xl">
          {fields.length === 0 && !cover ? (
            <p className="text-xs text-stone-500">
              Form chưa có field nào. Vào Bố cục card → Form thêm để kéo property vào.
            </p>
          ) : (
            <form action={formAction} className="flex flex-col gap-3">
              {cover && (
                <div>
                  <ImageDropZone name="coverImage" ratio={cover.ratio} active={open} />
                  <p className="mt-1 text-[11px] text-stone-400">Lưu vào: {cover.targetLabel}</p>
                </div>
              )}

              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {fields.map((field) => (
                  <FormField key={field.propertyId} field={field} />
                ))}
              </div>

              {state.error && <p className="text-xs text-red-600">{state.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {pending ? "Đang thêm…" : "Thêm vào Notion"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs text-stone-500 hover:underline"
                >
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

function FormField({ field }: { field: CreateFormField }) {
  const name = `field:${field.type}:${field.name}`;
  const label = (
    <span className="mb-0.5 block text-[11px] text-stone-500">
      {field.name}
      {field.required && <span className="ml-0.5 text-red-500">*</span>}
    </span>
  );
  const inputClass =
    "w-full rounded border border-stone-300 px-2 py-1 text-xs outline-none focus:border-emerald-600";

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-xs text-stone-700">
        <input type="checkbox" name={name} defaultChecked={field.initialValue === "true"} />
        {field.name}
      </label>
    );
  }

  if (field.type === "select" || field.type === "status") {
    return (
      <label className="block">
        {label}
        <select name={name} defaultValue={field.initialValue} className={inputClass}>
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "multi_select") {
    // One entry per line keeps this a plain input while still posting several values —
    // the server reads them with getAll, the same way the item editor's chips do.
    return (
      <label className="block">
        {label}
        <MultiSelectInput name={name} options={field.options ?? []} initial={field.initialValue} />
      </label>
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
            : "text";

  return (
    <label className="block">
      {label}
      <input
        type={inputType}
        name={name}
        defaultValue={field.initialValue}
        // The server enforces this too; here it just stops the trip being wasted.
        required={field.required}
        className={inputClass}
      />
    </label>
  );
}

function MultiSelectInput({
  name,
  options,
  initial,
}: {
  name: string;
  options: string[];
  initial: string;
}) {
  const [chosen, setChosen] = useState<string[]>(
    initial ? initial.split(",").map((v) => v.trim()).filter(Boolean) : [],
  );

  const toggle = (option: string) =>
    setChosen((current) =>
      current.includes(option) ? current.filter((v) => v !== option) : [...current, option],
    );

  return (
    <div className="rounded border border-stone-300 p-1">
      {chosen.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {options.length === 0 && <span className="px-1 text-[11px] text-stone-400">Chưa có option nào.</span>}
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              chosen.includes(option)
                ? "bg-emerald-600 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
