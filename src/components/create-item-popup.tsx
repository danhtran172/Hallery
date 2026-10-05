"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createItem, type CreateItemState } from "@/app/galleries/[galleryId]/create-item-actions";
import { ImageDropZone } from "@/components/image-drop-zone";
import { createFieldName } from "@/lib/create-form";
import { Icon } from "@/components/icons";
import { settingsHref } from "@/components/settings-header";
import { useDismiss } from "@/lib/use-dismiss";

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
  const [created, setCreated] = useState<string | null>(null);
  const router = useRouter();
  const action = createItem.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<CreateItemState, FormData>(action, { error: null });
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);
  useDismiss(wrapRef, open, () => setOpen(false));

  // Close once the write lands, and refresh so the new card is on the grid behind it. The
  // card can sit past the loaded batch or outside the current filter, so the notice links
  // straight to it.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setOpen(false);
      setCreated(state.createdPageId ?? null);
      router.refresh();
      const timer = window.setTimeout(() => setCreated(null), 8000);
      wasPending.current = pending;
      return () => window.clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending, state.error, state.createdPageId, router]);

  /**
   * Submitted by hand rather than through `action`: React resets a form after an action
   * runs, which wiped every typed value — and the picked image — whenever the server
   * answered with an error such as a missing required field.
   */
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="btn btn-primary"
      >
        <Icon name="plus" />
        Thêm item
      </button>
      {created && !open && (
        <div
          role="status"
          className="absolute top-full right-0 z-30 mt-2 flex animate-rise-in items-center gap-3 rounded-2xl bg-ink py-2 pr-2 pl-3.5 text-sm whitespace-nowrap text-surface shadow-pop"
        >
          <Icon name="check" className="size-4" />
          Đã thêm vào Notion
          <Link
            href={`/galleries/${galleryId}/items/${created}`}
            scroll={false}
            onClick={() => setCreated(null)}
            className="rounded-full bg-surface/15 px-3 py-1 text-xs font-medium hover:bg-surface/25"
          >
            Mở item
          </Link>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Thêm item"
          className="popover fixed inset-x-3 top-16 z-40 max-h-[calc(100dvh-5rem)] overflow-y-auto p-5 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[30rem]"
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="display text-lg text-ink">Thêm item</p>
            <Link
              href={settingsHref(galleryId, "card", undefined, undefined, { mode: "form" })}
              className="text-xs text-muted hover:text-ink"
            >
              Sửa form
            </Link>
          </div>
          {fields.length === 0 && !cover ? (
            <div className="flex flex-col gap-3 text-sm text-muted">
              <p>Form chưa có field nào.</p>
              <Link href={settingsHref(galleryId, "card", undefined, undefined, { mode: "form" })} className="btn btn-secondary btn-sm self-start">
                Chọn field cho form
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3.5">
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
                <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
                  {state.error}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
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
    <div className="rounded-xl border border-line-strong p-1.5">
      {chosen.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {options.length === 0 && <span className="px-1 text-[11px] text-faint">Chưa có option nào.</span>}
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={chosen.includes(option)}
            onClick={() => toggle(option)}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              chosen.includes(option) ? "bg-brand text-on-brand" : "bg-subtle text-ink-soft hover:bg-line"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
