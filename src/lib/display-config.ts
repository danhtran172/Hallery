import type { NativeButtonConfig } from "@/lib/native-button";

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
 *   button:  `button` holds the native actions Hallery runs in place of Notion's
 */
export type DisplayConfig = {
  kind?: string;
  max?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  /** Shown instead of the Notion property name. Renaming here never touches Notion. */
  nameOverride?: string;
  /** Native button actions, for Notion button properties. */
  button?: NativeButtonConfig;
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bare `yyyy-mm-dd` is a calendar day, not an instant. `new Date("2026-10-06")` reads it
 * as UTC midnight, which is the previous evening anywhere west of UTC — so it is split by
 * hand rather than parsed.
 */
function dateParts(iso: string): { date: Date; hasTime: boolean } {
  if (DATE_ONLY.test(iso)) {
    const [year, month, day] = iso.split("-").map(Number);
    return { date: new Date(year, month - 1, day), hasTime: false };
  }
  return { date: new Date(iso), hasTime: true };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatDateByGranularity(iso: string, kind: string | undefined): string {
  const { date: d, hasTime } = dateParts(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  if (kind === "year_only") return String(d.getFullYear());
  if (kind === "month_only") return `${VN_MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
  // Same shape as vi-VN's own short date (6/10/2026), plus the time when there is one.
  const day = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  return hasTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

/** A Notion date value — start, and end when it is a range — formatted for display. */
export function formatDateRange(value: { start: string; end: string | null }, kind: string | undefined): string {
  const start = formatDateByGranularity(value.start, kind);
  if (!value.end) return start;
  const end = formatDateByGranularity(value.end, kind);
  return end === start ? start : `${start} → ${end}`;
}
