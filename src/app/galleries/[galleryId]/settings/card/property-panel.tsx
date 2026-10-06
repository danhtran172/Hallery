"use client";

import { useState } from "react";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { configTypeOf, isConfigStranded } from "@/lib/property-kind";
import { TITLE_FIELD_ID } from "@/lib/card-layout";
import { AFFIX_TYPES, KIND_OPTIONS, allowsAffix } from "@/lib/display-kinds";

export type PanelProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  resolvedType: string | null;
  displayConfig: string;
};

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
  onConfigureButton,
}: {
  property: PanelProperty | null;
  showLabel: boolean;
  onToggleLabel: () => void;
  onChange: (propertyId: string, config: DisplayConfig) => void;
  isTitle: boolean;
  /** For a button: opens the popup where its look, confirmation and steps are set. */
  onConfigureButton?: () => void;
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
        <p className="text-xs text-muted">
          Tiêu đề của trang Notion. Luôn in đậm, không có tuỳ chỉnh hiển thị riêng — kéo nó ra khỏi card nếu
          không muốn hiện.
        </p>
      </Frame>
    );
  }

  if (!property) {
    return (
      <Frame title="Cấu hình property">
        <p className="text-xs text-faint">Chọn một property trên card để chỉnh cách nó hiển thị.</p>
      </Frame>
    );
  }

  const configType = configTypeOf(property.notionPropertyType, property.resolvedType);
  const kinds = KIND_OPTIONS[configType] ?? [];
  const allowAffix = allowsAffix(configType, config.kind);
  const stranded = isConfigStranded(configType, property.displayConfig);

  // Edits stay local until confirmed, so a half-typed name never lands in the draft the
  // form is about to submit.
  const update = (patch: Partial<DisplayConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  return (
    <Frame title="Cấu hình property">
      <div className="mb-3">
        <p className="truncate text-sm font-medium text-ink">{property.notionPropertyName}</p>
        <p className="font-mono text-[11px] text-faint">
          {property.notionPropertyType}
          {property.resolvedType ? ` → ${property.resolvedType}` : ""}
        </p>
      </div>

      <Section label="Tên hiển thị">
        <label className="mb-2 flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={showLabel} onChange={onToggleLabel} />
          Hiện tên trên card
        </label>
        <input
          type="text"
          value={config.nameOverride ?? ""}
          onChange={(event) => update({ nameOverride: event.target.value })}
          placeholder={property.notionPropertyName}
          className="w-full rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand"
        />
        <p className="mt-1 text-[11px] text-faint">
          Chỉ đổi trong Hallery — tên trong Notion giữ nguyên. Để trống để dùng tên gốc.
        </p>
      </Section>

      {stranded && (
        <p className="notice mb-4 text-xs">
          Kiểu đầu ra đã đổi thành <b>{property.resolvedType}</b>, nên kiểu hiển thị cũ không còn dùng được. Chọn lại
          bên dưới rồi lưu.
        </p>
      )}
      {configType === "unknown" && (
        <p className="mb-4 text-xs text-faint">
          Chưa xác định được kiểu đầu ra của công thức. Mở Gallery một lần (cần ít nhất một item) rồi quay lại đây.
        </p>
      )}
      {onConfigureButton && (
        <Section label="Nút bấm">
          <p className="mb-2 text-xs text-ink-soft">
            Chữ, biểu tượng, màu, hộp hỏi lại và các bước của nút được đặt một lần, dùng chung cho mọi view.
          </p>
          <button type="button" onClick={onConfigureButton} className="btn btn-secondary btn-sm">
            Cấu hình nút
          </button>
        </Section>
      )}
      {!onConfigureButton && kinds.length === 0 && !AFFIX_TYPES.has(configType) && configType !== "unknown" && (
        <p className="mb-4 text-xs text-faint">Kiểu này hiển thị theo mặc định — không có tuỳ chỉnh định dạng riêng.</p>
      )}

      {kinds.length > 0 && (
        <Section label="Kiểu hiển thị">
          <div className="flex flex-col gap-1">
            {kinds.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-xs text-ink-soft">
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
              className="mt-2 w-20 rounded-md border border-line-strong px-2 py-1 text-xs outline-none focus:border-brand"
            />
          )}
          {config.kind === "button" && (
            <input
              type="text"
              value={config.label ?? ""}
              onChange={(event) => update({ label: event.target.value })}
              placeholder="Chữ trên nút"
              className="mt-2 w-full rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand"
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
              className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand"
            />
            <input
              type="text"
              value={config.suffix ?? ""}
              onChange={(event) => update({ suffix: event.target.value })}
              placeholder="Sau"
              className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand"
            />
          </div>
        </Section>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onChange(property.notionPropertyId, config);
            setDirty(false);
          }}
          className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:bg-stone-200 disabled:text-faint"
        >
          {dirty ? "Lưu cấu hình" : "Đã lưu"}
        </button>
        <p className="mt-2 text-[11px] text-faint">
          Áp dụng cho mọi view của Gallery. Card và Card Detail định dạng riêng — chỉnh ở tab nào thì tab đó đổi. Ghi
          xuống khi bấm Lưu bố cục.
        </p>
      </div>
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto rounded-3xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      {children}
    </div>
  );
}

export { TITLE_FIELD_ID };
