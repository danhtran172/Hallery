"use client";

import { useActionState, useState } from "react";
import { saveCardLayout, type SaveCardLayoutState } from "./actions";

export type EditableCardProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
};

type Row = { id: string; showLabel: boolean };

/**
 * Reordering uses buttons rather than dragging: the list is short, and buttons stay
 * usable from the keyboard without pulling in a sortable library.
 */
export function CardLayoutEditor({
  galleryId,
  properties,
  initialFields,
  previewTitle,
  previewValues,
}: {
  galleryId: string;
  properties: EditableCardProperty[];
  initialFields: Row[];
  previewTitle: string;
  previewValues: Record<string, string>;
}) {
  const [rows, setRows] = useState<Row[]>(initialFields);
  const action = saveCardLayout.bind(null, galleryId);
  const [state, formAction, pending] = useActionState<SaveCardLayoutState, FormData>(action, {
    error: null,
  });

  const byId = new Map(properties.map((p) => [p.notionPropertyId, p]));
  const shown = rows.filter((row) => byId.has(row.id));
  const hidden = properties.filter((p) => !rows.some((row) => row.id === p.notionPropertyId));

  const move = (index: number, delta: number) =>
    setRows((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const toggleLabel = (id: string) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, showLabel: !row.showLabel } : row)),
    );

  return (
    <form action={formAction} className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <input type="hidden" name="fields" value={JSON.stringify(shown)} />

      <div className="min-w-0 flex-1 flex flex-col gap-6">
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
            Hiện trên card
          </h2>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
              Card sẽ chỉ có ảnh bìa và tiêu đề.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((row, index) => {
                const property = byId.get(row.id)!;
                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2"
                  >
                    <span className="w-5 shrink-0 text-center text-xs tabular-nums text-stone-400">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-stone-800">
                      {property.notionPropertyName}
                      <span className="ml-2 font-mono text-xs text-stone-400">
                        {property.notionPropertyType}
                      </span>
                    </span>

                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-stone-600">
                      <input
                        type="checkbox"
                        checked={row.showLabel}
                        onChange={() => toggleLabel(row.id)}
                      />
                      Hiện tên
                    </label>

                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton label="Lên" disabled={index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </IconButton>
                      <IconButton
                        label="Xuống"
                        disabled={index === shown.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </IconButton>
                      <IconButton
                        label="Bỏ khỏi card"
                        onClick={() => setRows((c) => c.filter((r) => r.id !== row.id))}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
            Chưa hiện
          </h2>
          {hidden.length === 0 ? (
            <p className="text-sm text-stone-400">Mọi property đều đang hiện trên card.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hidden.map((property) => (
                <button
                  key={property.notionPropertyId}
                  type="button"
                  onClick={() =>
                    setRows((c) => [...c, { id: property.notionPropertyId, showLabel: true }])
                  }
                  className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:border-emerald-600 hover:text-emerald-800"
                >
                  + {property.notionPropertyName}
                </button>
              ))}
            </div>
          )}
        </section>

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
        title={previewTitle}
        rows={shown}
        byId={byId}
        values={previewValues}
      />
    </form>
  );
}

function CardPreview({
  title,
  rows,
  byId,
  values,
}: {
  title: string;
  rows: Row[];
  byId: Map<string, EditableCardProperty>;
  values: Record<string, string>;
}) {
  return (
    <div className="w-full shrink-0 lg:w-72">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Xem trước</h2>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="mb-2 aspect-[16/9] w-full rounded bg-stone-100" />
        <p className="mb-2 font-medium text-stone-900">{title}</p>
        <dl className="flex flex-col gap-1 text-sm text-stone-600">
          {rows.map((row) => {
            const property = byId.get(row.id);
            if (!property) return null;
            const value = values[row.id] ?? "—";
            return (
              <div key={row.id} className="flex items-baseline gap-2">
                {row.showLabel && (
                  <dt className="w-24 shrink-0 truncate text-xs text-stone-400">
                    {property.notionPropertyName}
                  </dt>
                )}
                <dd className="min-w-0 flex-1 truncate">{value}</dd>
              </div>
            );
          })}
        </dl>
      </div>
      <p className="mt-2 text-[11px] text-stone-400">
        Ảnh bìa và số card mỗi hàng chỉnh ở trang Ảnh bìa và Cài đặt hiển thị.
      </p>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 rounded border border-stone-300 text-xs text-stone-600 hover:border-stone-400 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
