"use client";

import { saveDisplayConfig } from "@/app/galleries/[galleryId]/settings/display/actions";
import { parseDisplayConfig } from "@/lib/display-config";
import { configTypeOf, isConfigStranded } from "@/lib/property-kind";

const CONFIGURABLE_TYPES = new Set([
  "number",
  "url",
  "date",
  "select",
  "status",
  "multi_select",
  "rich_text",
]);

export type DisplayConfigProperty = {
  id: string;
  notionPropertyType: string;
  resolvedType: string | null;
  displayConfig: string;
};

/** The one display-configuration form used by both Settings and the Layout Builder. */
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
  const action = saveDisplayConfig.bind(null, galleryId, property.id, configType);

  if (configType === "unknown") {
    return (
      <p className="text-sm text-stone-400">
        Chưa xác định được kiểu đầu ra. Thêm ít nhất một item vào database rồi mở lại trang này.
      </p>
    );
  }

  if (!CONFIGURABLE_TYPES.has(configType)) {
    return <p className="text-sm text-stone-400">Chưa có tuỳ chỉnh hiển thị cho kiểu này.</p>;
  }

  const stranded = isConfigStranded(configType, property.displayConfig);

  return (
    <form action={action} className="flex flex-col gap-3">
      {stranded && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Kiểu đầu ra đã đổi thành <b>{property.resolvedType}</b>, nên cấu hình hiển thị cũ không còn dùng được.
          Chọn lại bên dưới rồi lưu.
        </p>
      )}
      {configType === "number" && <NumberFields cfg={cfg} />}
      {configType === "url" && <UrlFields cfg={cfg} />}
      {configType === "date" && <DateFields cfg={cfg} />}
      {configType === "rich_text" && <TextAffixFields cfg={cfg} />}
      {["select", "status", "multi_select"].includes(configType) && <AffixFields cfg={cfg} />}
      <button
        type="submit"
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
      >
        Lưu kiểu hiển thị
      </button>
    </form>
  );
}

function NumberFields({ cfg }: { cfg: { kind?: string; max?: number; prefix?: string; suffix?: string } }) {
  return (
    <>
      <RadioGroup
        name="kind"
        defaultValue={cfg.kind ?? "plain"}
        options={[
          { value: "plain", label: "Số thường" },
          { value: "rate", label: "Số sao (Rate)" },
          { value: "duration", label: "Giờ : phút — số ghi trong Notion vẫn là tổng phút" },
          { value: "with_text", label: "Kèm chữ trước/sau" },
        ]}
      />
      <TextField name="max" label="Số sao tối đa (chỉ dùng khi chọn Rate)" defaultValue={String(cfg.max ?? 5)} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="prefix" label="Chữ trước (With text)" defaultValue={cfg.prefix ?? ""} />
        <TextField name="suffix" label="Chữ sau (With text)" defaultValue={cfg.suffix ?? ""} />
      </div>
    </>
  );
}

function UrlFields({ cfg }: { cfg: { kind?: string; label?: string } }) {
  return (
    <>
      <RadioGroup
        name="kind"
        defaultValue={cfg.kind ?? "link"}
        options={[
          { value: "link", label: "Link thường" },
          { value: "button", label: "Nút bấm" },
        ]}
      />
      <TextField name="label" label="Chữ trên nút (chỉ dùng khi chọn Nút bấm)" defaultValue={cfg.label ?? ""} />
    </>
  );
}

function DateFields({ cfg }: { cfg: { kind?: string } }) {
  return (
    <RadioGroup
      name="kind"
      defaultValue={cfg.kind ?? "full"}
      options={[
        { value: "full", label: "Đầy đủ (ngày/tháng/năm)" },
        { value: "month_only", label: "Chỉ tháng" },
        { value: "year_only", label: "Chỉ năm" },
      ]}
    />
  );
}

function TextAffixFields({ cfg }: { cfg: { prefix?: string; suffix?: string } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="prefix" label="Chữ trước" defaultValue={cfg.prefix ?? ""} />
      <TextField name="suffix" label="Chữ sau" defaultValue={cfg.suffix ?? ""} />
    </div>
  );
}

function AffixFields({ cfg }: { cfg: { kind?: string; prefix?: string; suffix?: string } }) {
  return (
    <>
      <RadioGroup
        name="kind"
        defaultValue={cfg.kind ?? "pill"}
        options={[
          { value: "pill", label: "Hiển thị dạng pill (có màu)" },
          { value: "text", label: "Hiển thị dạng chữ thường" },
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
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 text-sm text-stone-700">
          <input type="radio" name={name} value={opt.value} defaultChecked={defaultValue === opt.value} />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function TextField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-stone-500">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
      />
    </label>
  );
}
