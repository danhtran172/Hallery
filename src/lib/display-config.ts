/**
 * Per-property display config, stored as JSON in PropertyConfig.displayConfig.
 * Flat/loose on purpose: which keys matter depends on `kind`, which depends on
 * the Notion property type — see the "meaning per type" table below.
 *
 *   number:  kind = "plain" | "rate" | "duration" | "with_text"
 *            rate uses `max`; with_text uses `prefix`/`suffix`
 *   url:     kind = "link" | "button"  (button uses `label`)
 *   date:    kind = "full" | "month_only" | "year_only"
 *   select / multi_select / status: kind = "pill" | "text", plus `prefix`/`suffix`
 */
export type DisplayConfig = {
  kind?: string;
  max?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
};

export function parseDisplayConfig(raw: string): DisplayConfig {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (hours === 0) return `${sign}${minutes}p`;
  if (minutes === 0) return `${sign}${hours}g`;
  return `${sign}${hours}g ${minutes}p`;
}

const VN_MONTHS = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
  "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12",
];

export function formatDateByGranularity(iso: string, kind: string | undefined): string {
  const d = new Date(iso);
  if (kind === "year_only") return String(d.getFullYear());
  if (kind === "month_only") return `${VN_MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
  return d.toLocaleDateString("vi-VN");
}
