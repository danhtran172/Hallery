/**
 * The display styles offered per config type, as the editors list them. Mirrors the
 * `kind` values in lib/display-config; the first of each list is that type's default.
 */
export const KIND_OPTIONS: Record<string, { value: string; label: string }[]> = {
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
export const AFFIX_TYPES = new Set(["number", "select", "status", "multi_select", "rich_text"]);

/** Whether a prefix/suffix renders for this type and style — a number shows them only "with text". */
export function allowsAffix(configType: string, kind: string | undefined): boolean {
  return AFFIX_TYPES.has(configType) && (configType !== "number" || kind === "with_text");
}
