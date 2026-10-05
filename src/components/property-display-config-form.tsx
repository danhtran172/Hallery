"use client";

import { useActionState } from "react";
import { saveDisplayConfig } from "@/app/galleries/[galleryId]/settings/display/actions";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { configTypeOf, isConfigStranded } from "@/lib/property-kind";

const FORMATTABLE_TYPES = new Set(["number", "url", "date", "select", "status", "multi_select", "rich_text"]);

export type DisplayConfigProperty = {
  id: string;
  notionPropertyName: string;
  notionPropertyType: string;
  resolvedType: string | null;
  displayConfig: string;
  /** The Card Detail's own formatting from the card editor; empty when it shares this one. */
  detailDisplayConfig?: string;
};

type SaveState = { savedAt: number | null; error: string | null };

/** The display-configuration form: a Hallery-only name, plus formatting for the type. */
export function PropertyDisplayConfigForm({
  galleryId,
  property,
}: {
  galleryId: string;
  property: DisplayConfigProperty;
}) {
  const cfg = parseDisplayConfig(property.displayConfig);
  // Formula and rollup borrow the options of whatever they evaluate to.
  const configType = configTypeOf(property.notionPropertyType, property.resolvedType);
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    async (_previous, formData) => {
      try {
        const result = await saveDisplayConfig(galleryId, property.id, configType, formData);
        return result.error ? { savedAt: null, error: result.error } : { savedAt: Date.now(), error: null };
      } catch {
        return { savedAt: null, error: "Không lưu được. Thử lại sau giây lát." };
      }
    },
    { savedAt: null, error: null },
  );
  const detailOverride = Boolean(property.detailDisplayConfig && property.detailDisplayConfig !== "{}");

  const stranded = isConfigStranded(configType, property.displayConfig);
  const formattable = FORMATTABLE_TYPES.has(configType);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor={`name-${property.id}`} className="field-label">
          Tên hiển thị
        </label>
        <input
          id={`name-${property.id}`}
          name="nameOverride"
          defaultValue={cfg.nameOverride ?? ""}
          placeholder={property.notionPropertyName}
          className="input input-sm"
        />
        <span className="field-hint">Chỉ đổi trong Hallery — tên trong Notion giữ nguyên. Để trống để dùng tên gốc.</span>
      </div>

      {stranded && (
        <p className="notice text-xs">
          Kiểu đầu ra đã đổi thành <b>{property.resolvedType}</b>, nên cấu hình hiển thị cũ không còn dùng được. Chọn
          lại bên dưới rồi lưu.
        </p>
      )}
      {configType === "unknown" && (
        <p className="text-xs text-faint">
          Chưa xác định được kiểu đầu ra của công thức. Mở Gallery một lần (cần ít nhất một item) rồi quay lại đây.
        </p>
      )}
      {configType === "number" && <NumberFields cfg={cfg} />}
      {configType === "url" && <UrlFields cfg={cfg} />}
      {configType === "date" && <DateFields cfg={cfg} />}
      {configType === "rich_text" && <TextAffixFields cfg={cfg} />}
      {["select", "status", "multi_select"].includes(configType) && <AffixFields cfg={cfg} />}
      {!formattable && configType !== "unknown" && (
        <p className="text-xs text-faint">Kiểu này hiển thị theo mặc định — không có tuỳ chỉnh định dạng riêng.</p>
      )}

      {detailOverride && (
        <label className="flex items-start gap-2 rounded-2xl bg-subtle px-3.5 py-3 text-xs text-ink-soft ring-1 ring-line">
          <input type="checkbox" name="applyToDetail" className="mt-0.5 accent-brand" />
          <span>
            Card Detail đang dùng định dạng riêng (đặt ở Bố cục card → Card Detail), nên thay đổi ở đây chưa hiện trong
            Card Detail. Tick để dùng định dạng này cho cả Card Detail.
          </span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Đang lưu…" : "Lưu"}
        </button>
        {state.savedAt && !pending && (
          <span role="status" className="text-xs text-brand-ink">
            Đã lưu
          </span>
        )}
        {state.error && !pending && (
          <span role="alert" className="text-xs text-danger">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function NumberFields({ cfg }: { cfg: DisplayConfig }) {
  return (
    <>
      <RadioGroup
        name="kind"
        legend="Kiểu hiển thị"
        defaultValue={cfg.kind ?? "plain"}
        options={[
          { value: "plain", label: "Số thường" },
          { value: "rate", label: "Số sao (Rate)" },
          { value: "duration", label: "Giờ : phút — số ghi trong Notion vẫn là tổng phút" },
          { value: "with_text", label: "Kèm chữ trước/sau" },
        ]}
      />
      <TextField name="max" label="Số sao tối đa (khi chọn Rate)" defaultValue={String(cfg.max ?? 5)} inputMode="numeric" />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="prefix" label="Chữ trước (Kèm chữ)" defaultValue={cfg.prefix ?? ""} />
        <TextField name="suffix" label="Chữ sau (Kèm chữ)" defaultValue={cfg.suffix ?? ""} />
      </div>
    </>
  );
}

function UrlFields({ cfg }: { cfg: DisplayConfig }) {
  return (
    <>
      <RadioGroup
        name="kind"
        legend="Kiểu hiển thị"
        defaultValue={cfg.kind ?? "link"}
        options={[
          { value: "link", label: "Link thường" },
          { value: "button", label: "Nút bấm — mở link trong tab mới" },
        ]}
      />
      <TextField
        name="label"
        label="Chữ trên nút (khi chọn Nút bấm)"
        defaultValue={cfg.label ?? ""}
        placeholder="Để trống: hiện tên miền của link"
      />
    </>
  );
}

function DateFields({ cfg }: { cfg: DisplayConfig }) {
  return (
    <RadioGroup
      name="kind"
      legend="Kiểu hiển thị"
      defaultValue={cfg.kind ?? "full"}
      options={[
        { value: "full", label: "Đầy đủ (ngày/tháng/năm, kèm giờ nếu có)" },
        { value: "month_only", label: "Chỉ tháng" },
        { value: "year_only", label: "Chỉ năm" },
      ]}
    />
  );
}

function TextAffixFields({ cfg }: { cfg: DisplayConfig }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="prefix" label="Chữ trước" defaultValue={cfg.prefix ?? ""} />
      <TextField name="suffix" label="Chữ sau" defaultValue={cfg.suffix ?? ""} />
    </div>
  );
}

function AffixFields({ cfg }: { cfg: DisplayConfig }) {
  return (
    <>
      <RadioGroup
        name="kind"
        legend="Kiểu hiển thị"
        defaultValue={cfg.kind ?? "pill"}
        options={[
          { value: "pill", label: "Dạng pill (có màu)" },
          { value: "text", label: "Dạng chữ thường" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="prefix" label="Chữ trước" defaultValue={cfg.prefix ?? ""} />
        <TextField name="suffix" label="Chữ sau" defaultValue={cfg.suffix ?? ""} />
      </div>
    </>
  );
}

function RadioGroup({
  name,
  legend,
  defaultValue,
  options,
}: {
  name: string;
  legend: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="field-label">{legend}</legend>
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="radio" name={name} value={opt.value} defaultChecked={defaultValue === opt.value} className="accent-brand" />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  placeholder,
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <label className="flex flex-col">
      <span className="field-label">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        inputMode={inputMode}
        className="input input-sm"
      />
    </label>
  );
}
