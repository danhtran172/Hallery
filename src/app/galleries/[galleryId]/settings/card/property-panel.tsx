"use client";

import { useState } from "react";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { configTypeOf } from "@/lib/property-kind";
import { TITLE_FIELD_ID } from "@/lib/card-layout";

export type PanelProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  resolvedType: string | null;
  displayConfig: string;
};

const KIND_OPTIONS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: "plain", label: "Số thường" },
    { value: "rate", label: "Sao đánh giá" },
    { value: "duration", label: "Giờ : phút" },
    { value: "with_text", label: "Kèm chữ trước/sau" },
  ],
  url: [
    { value: "link", label: "Link" },
    { value: "button", label: "Nút bấm" },
  ],
  date: [
    { value: "full", label: "Ngày/tháng/năm" },
    { value: "month_only", label: "Chỉ tháng" },
    { value: "year_only", label: "Chỉ năm" },
  ],
  select: [
    { value: "pill", label: "Pill có màu" },
    { value: "text", label: "Chữ thường" },
  ],
};
KIND_OPTIONS.status = KIND_OPTIONS.select;
KIND_OPTIONS.multi_select = KIND_OPTIONS.select;

/** Types where a prefix or suffix reads as sensible rather than noise. */
const AFFIX_TYPES = new Set(["number", "select", "status", "multi_select", "rich_text"]);

/**
 * Config for whichever property is selected on the canvas. Edits land on the view being
 * arranged, not on both: the gallery card and the Card Detail format independently, so a
 * score can be stars on a thumbnail and a plain number on the page.
 */
export function PropertyPanel({
  property,
  showLabel,
  onToggleLabel,
  onChange,
  isTitle,
}: {
  property: PanelProperty | null;
  showLabel: boolean;
  onToggleLabel: () => void;
  onChange: (propertyId: string, config: DisplayConfig) => void;
  isTitle: boolean;
}) {
  // Seeded once per property: the caller remounts this panel when the selection changes,
  // which keeps the draft out of an effect that would cascade renders.
  const [config, setConfig] = useState<DisplayConfig>(() =>
    property ? parseDisplayConfig(property.displayConfig) : {},
  );
  const [dirty, setDirty] = useState(false);

  if (isTitle) {
    return (
      <Frame title="Tiêu đề">
        <p className="text-xs text-stone-500">
          Tiêu đề của trang Notion. Luôn in đậm, không có tuỳ chỉnh hiển thị riêng — kéo nó ra khỏi card nếu
          không muốn hiện.
        </p>
      </Frame>
    );
  }

  if (!property) {
    return (
      <Frame title="Cấu hình property">
        <p className="text-xs text-stone-400">Chọn một property trên card để chỉnh cách nó hiển thị.</p>
      </Frame>
    );
  }

  const configType = configTypeOf(property.notionPropertyType, property.resolvedType);
  const kinds = KIND_OPTIONS[configType] ?? [];
  const allowAffix = AFFIX_TYPES.has(configType);

  // Edits stay local until confirmed, so a half-typed name never lands in the draft the
  // form is about to submit.
  const update = (patch: Partial<DisplayConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  return (
    <Frame title="Cấu hình property">
      <div className="mb-3">
        <p className="truncate text-sm font-medium text-stone-900">{property.notionPropertyName}</p>
        <p className="font-mono text-[11px] text-stone-400">
          {property.notionPropertyType}
          {property.resolvedType ? ` → ${property.resolvedType}` : ""}
        </p>
      </div>

      <Section label="Tên hiển thị">
        <label className="mb-2 flex items-center gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={showLabel} onChange={onToggleLabel} />
          Hiện tên trên card
        </label>
        <input
          type="text"
          value={config.nameOverride ?? ""}
          onChange={(event) => update({ nameOverride: event.target.value })}
          placeholder={property.notionPropertyName}
          disabled={!showLabel}
          className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-600 disabled:bg-stone-50 disabled:text-stone-400"
        />
        <p className="mt-1 text-[11px] text-stone-400">Đổi tên ở đây không đổi tên trong Notion.</p>
      </Section>

      {kinds.length > 0 && (
        <Section label="Kiểu hiển thị">
          <div className="flex flex-col gap-1">
            {kinds.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-xs text-stone-700">
                <input
                  type="radio"
                  name="kind"
                  checked={(config.kind ?? kinds[0].value) === option.value}
                  onChange={() => update({ kind: option.value })}
                />
                {option.label}
              </label>
            ))}
          </div>
          {config.kind === "rate" && (
            <input
              type="number"
              min={1}
              max={10}
              value={config.max ?? 5}
              onChange={(event) => update({ max: Number(event.target.value) || 5 })}
              className="mt-2 w-20 rounded-md border border-stone-300 px-2 py-1 text-xs outline-none focus:border-emerald-600"
            />
          )}
          {config.kind === "button" && (
            <input
              type="text"
              value={config.label ?? ""}
              onChange={(event) => update({ label: event.target.value })}
              placeholder="Chữ trên nút"
              className="mt-2 w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-600"
            />
          )}
        </Section>
      )}

      {allowAffix && (
        <Section label="Chữ kèm theo">
          <div className="flex gap-2">
            <input
              type="text"
              value={config.prefix ?? ""}
              onChange={(event) => update({ prefix: event.target.value })}
              placeholder="Trước"
              className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-600"
            />
            <input
              type="text"
              value={config.suffix ?? ""}
              onChange={(event) => update({ suffix: event.target.value })}
              placeholder="Sau"
              className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-600"
            />
          </div>
        </Section>
      )}

      <div className="mt-4 border-t border-stone-200 pt-3">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onChange(property.notionPropertyId, config);
            setDirty(false);
          }}
          className="w-full rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400"
        >
          {dirty ? "Lưu cấu hình" : "Đã lưu"}
        </button>
        <p className="mt-2 text-[11px] text-stone-400">
          Cấu hình này dùng chung với Gallery và Card Detail, ghi xuống khi bấm Lưu bố cục.
        </p>
      </div>
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-stone-500">{title}</h2>
      {children}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      {children}
    </div>
  );
}

export { TITLE_FIELD_ID };
