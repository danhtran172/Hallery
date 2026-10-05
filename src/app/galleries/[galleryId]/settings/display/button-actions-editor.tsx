"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  OP_LABELS,
  opTakesValue,
  opsFor,
  type ButtonAction,
  type ButtonOp,
  type NativeButtonConfig,
} from "@/lib/native-button";
import { saveNativeButton } from "./actions";

export type WritableProperty = {
  notionPropertyId: string;
  name: string;
  type: string;
  options?: string[];
};

/**
 * Builds what a Notion button does inside Hallery: a label and a list of value writes, run
 * top to bottom as one save. The owner's own "Mark As Read" is the model case — set the
 * status, stamp the read date.
 */
export function ButtonActionsEditor({
  galleryId,
  propertyConfigId,
  propertyName,
  initial,
  properties,
}: {
  galleryId: string;
  propertyConfigId: string;
  propertyName: string;
  initial: NativeButtonConfig | null;
  properties: WritableProperty[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [confirm, setConfirm] = useState(initial?.confirm ?? false);
  const [actions, setActions] = useState<ButtonAction[]>(initial?.actions ?? []);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  const byId = new Map(properties.map((property) => [property.notionPropertyId, property]));
  const change = (next: ButtonAction[]) => {
    setActions(next);
    setDirty(true);
    setStatus(null);
  };

  function addAction() {
    const first = properties[0];
    if (!first) return;
    change([...actions, { propertyId: first.notionPropertyId, op: opsFor(first.type)[0], value: "" }]);
  }

  function save() {
    const cleaned = actions.filter((action) => !opTakesValue(action.op) || (action.value ?? "").trim() !== "");
    startTransition(async () => {
      const result = await saveNativeButton(
        galleryId,
        propertyConfigId,
        cleaned.length ? { label: label.trim() || undefined, confirm, actions: cleaned } : null,
      );
      if (result.error) {
        setStatus({ ok: false, message: result.error });
        return;
      }
      setActions(cleaned);
      setDirty(false);
      setStatus({ ok: true, message: cleaned.length ? "Đã lưu — nút đã chạy được trên card và Card Detail." : "Đã gỡ hành động." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-canvas px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
        Notion không cho bấm nút của nó qua API. Gán hành động ở đây để nút <b>{propertyName}</b> chạy được ngay trong
        Hallery. Mọi hành động chỉ ghi <i>giá trị</i> vào chính item đó — không đụng tới cấu trúc database.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="button-label">
            Chữ trên nút
          </label>
          <input
            id="button-label"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setDirty(true);
            }}
            placeholder={propertyName}
            className="input input-sm"
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(event) => {
              setConfirm(event.target.checked);
              setDirty(true);
            }}
            className="accent-brand"
          />
          Hỏi lại trước khi chạy
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label mb-0">Khi bấm, lần lượt:</span>
        {actions.length === 0 && <p className="text-xs text-faint">Chưa có hành động nào.</p>}
        {actions.map((action, index) => {
          const property = byId.get(action.propertyId);
          const ops = property ? opsFor(property.type) : [];
          const replace = (patch: Partial<ButtonAction>) =>
            change(actions.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
          return (
            <div key={index} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line p-2">
              <span className="w-5 text-center text-xs text-faint">{index + 1}</span>
              <select
                aria-label="Property"
                value={action.propertyId}
                onChange={(event) => {
                  const next = byId.get(event.target.value);
                  replace({ propertyId: event.target.value, op: next ? opsFor(next.type)[0] : "set", value: "" });
                }}
                className="input input-sm w-auto min-w-36 flex-1"
              >
                {!property && <option value={action.propertyId}>(property đã mất)</option>}
                {properties.map((entry) => (
                  <option key={entry.notionPropertyId} value={entry.notionPropertyId}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Hành động"
                value={action.op}
                onChange={(event) => replace({ op: event.target.value as ButtonOp, value: "" })}
                className="input input-sm w-auto"
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>
              {opTakesValue(action.op) &&
                (property?.options?.length && action.op !== "increment" ? (
                  <select
                    aria-label="Giá trị"
                    value={action.value ?? ""}
                    onChange={(event) => replace({ value: event.target.value })}
                    className="input input-sm w-auto min-w-32"
                  >
                    <option value="">— chọn —</option>
                    {property.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="Giá trị"
                    value={action.value ?? ""}
                    onChange={(event) => replace({ value: event.target.value })}
                    inputMode={action.op === "increment" || property?.type === "number" ? "decimal" : undefined}
                    placeholder={action.op === "increment" ? "vd. 1 hoặc -1" : "Giá trị"}
                    className="input input-sm w-32"
                  />
                ))}
              <button
                type="button"
                aria-label="Bỏ hành động này"
                onClick={() => change(actions.filter((_, i) => i !== index))}
                className="btn btn-ghost btn-sm btn-icon ml-auto"
              >
                ✕
              </button>
            </div>
          );
        })}
        {properties.length > 0 ? (
          <button type="button" onClick={addAction} className="btn btn-secondary btn-sm self-start">
            + Thêm hành động
          </button>
        ) : (
          <p className="text-xs text-faint">Database này không có property nào ghi được.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
          {pending ? "Đang lưu…" : "Lưu hành động"}
        </button>
        {status && (
          <span role="status" className={`text-xs ${status.ok ? "text-brand" : "text-danger"}`}>
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
