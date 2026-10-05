"use client";

import {
  DEFAULT_MODE_LABELS,
  defaultModesFor,
  type DefaultMode,
  type FormFieldConfig,
} from "@/lib/create-form";

/**
 * Entry behaviour for the field selected on the form canvas.
 *
 * The form has nothing to format — it draws inputs, not values — so this panel replaces the
 * display config with the two things an input needs: whether it must be filled, and what it
 * starts out holding.
 */
export function FormFieldPanel({
  propertyName,
  propertyType,
  config,
  onChange,
}: {
  propertyName: string | null;
  propertyType: string | null;
  config: FormFieldConfig;
  onChange: (next: FormFieldConfig) => void;
}) {
  if (!propertyName || !propertyType) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Field trong form</p>
        <p className="text-xs text-faint">Chọn một field trên form để chỉnh cách nhập.</p>
      </div>
    );
  }

  const modes = defaultModesFor(propertyType);
  const mode: DefaultMode = config.defaultMode ?? "none";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Field trong form</p>
        <p className="truncate text-sm font-medium text-ink">{propertyName}</p>
        <span className="font-mono text-[10px] text-faint">{propertyType}</span>
      </div>

      <label className="flex items-start gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={config.required === true}
          onChange={(event) => onChange({ ...config, required: event.target.checked })}
          className="mt-0.5"
        />
        <span>
          Bắt buộc nhập
          <span className="mt-0.5 block text-[11px] text-muted">
            Notion không có khái niệm này — Hallery tự chặn lúc gửi.
          </span>
        </span>
      </label>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Giá trị mặc định</p>
        <div className="flex flex-col gap-1">
          {modes.map((option) => (
            <label key={option} className="flex items-center gap-2 text-xs text-ink-soft">
              <input
                type="radio"
                name="defaultMode"
                checked={mode === option}
                onChange={() => onChange({ ...config, defaultMode: option })}
              />
              {DEFAULT_MODE_LABELS[option]}
            </label>
          ))}
        </div>
      </div>

      {mode === "static" && (
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Giá trị
          <input
            type={propertyType === "date" ? "date" : propertyType === "number" ? "number" : "text"}
            value={config.defaultValue ?? ""}
            onChange={(event) => onChange({ ...config, defaultValue: event.target.value })}
            className="rounded border border-line-strong px-2 py-1 text-xs outline-none focus:border-brand"
          />
          {(propertyType === "select" || propertyType === "status" || propertyType === "multi_select") && (
            <span className="text-[11px] text-muted">
              Gõ đúng tên option. Nhiều giá trị thì ngăn bằng dấu phẩy.
            </span>
          )}
        </label>
      )}
    </div>
  );
}
