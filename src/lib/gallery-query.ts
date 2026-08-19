import type { PageObjectResponse } from "@notionhq/client";
import { plainTextValue } from "@/lib/property-text";

/**
 * Filter, sort, search and grouping over the rows a Gallery already holds.
 *
 * All of it runs locally rather than as Notion query arguments. Notion could do the work,
 * but every change of a filter would then be a round trip on a ~3 req/s budget, and the
 * grid would stutter on each keystroke. The snapshot walks the cursor to the end (see
 * lib/gallery-notion-cache), so working from it is both instant and complete.
 *
 * State is encoded into the URL so a filtered view can be shared and the back button
 * behaves — the same choice the category axis already made.
 */

type PropertyValue = PageObjectResponse["properties"][string];

/* ── Filters ─────────────────────────────────────────────────────────────── */

export const TEXT_OPERATORS = ["contains", "not_contains", "is", "is_not", "empty", "not_empty"] as const;
export const NUMBER_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"] as const;
export const SELECT_OPERATORS = ["is", "is_not", "empty", "not_empty"] as const;
export const CHECKBOX_OPERATORS = ["is_checked", "is_unchecked"] as const;
export const DATE_OPERATORS = ["on", "before", "after", "empty", "not_empty"] as const;

export type FilterOperator =
  | (typeof TEXT_OPERATORS)[number]
  | (typeof NUMBER_OPERATORS)[number]
  | (typeof CHECKBOX_OPERATORS)[number]
  | (typeof DATE_OPERATORS)[number];

export type Filter = {
  propertyId: string;
  operator: FilterOperator;
  /** Unused by the empty/checked operators. */
  value?: string;
};

/** Operators that make sense for a property, keyed by its config type. */
export function operatorsFor(configType: string): readonly FilterOperator[] {
  if (configType === "number") return NUMBER_OPERATORS;
  if (configType === "checkbox") return CHECKBOX_OPERATORS;
  if (configType === "date") return DATE_OPERATORS;
  if (configType === "select" || configType === "status" || configType === "multi_select") {
    return SELECT_OPERATORS;
  }
  return TEXT_OPERATORS;
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "chứa",
  not_contains: "không chứa",
  is: "là",
  is_not: "không là",
  empty: "trống",
  not_empty: "có giá trị",
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is_checked: "đã tick",
  is_unchecked: "chưa tick",
  on: "đúng ngày",
  before: "trước ngày",
  after: "sau ngày",
};

function propertyOf(page: PageObjectResponse, propertyId: string): PropertyValue | undefined {
  return Object.values(page.properties).find((property) => property.id === propertyId);
}

/** Numeric reading of a value, or null when it has none. Formulas and rollups count. */
function numberOf(value: PropertyValue | undefined): number | null {
  if (!value) return null;
  if (value.type === "number") return value.number;
  if (value.type === "formula" && value.formula.type === "number") return value.formula.number;
  if (value.type === "rollup" && value.rollup.type === "number") return value.rollup.number;
  const parsed = Number(plainTextValue(value));
  return Number.isFinite(parsed) && plainTextValue(value).trim() !== "" ? parsed : null;
}

/** Date reading of a value as a timestamp, or null. */
function dateOf(value: PropertyValue | undefined): number | null {
  if (!value) return null;
  const iso =
    value.type === "date"
      ? value.date?.start
      : value.type === "created_time"
        ? value.created_time
        : value.type === "last_edited_time"
          ? value.last_edited_time
          : value.type === "formula" && value.formula.type === "date"
            ? value.formula.date?.start
            : value.type === "rollup" && value.rollup.type === "date"
              ? value.rollup.date?.start
              : undefined;
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Comparable strings for a value — several for multi-select, none when empty. */
function stringsOf(value: PropertyValue | undefined): string[] {
  if (!value) return [];
  if (value.type === "multi_select") return value.multi_select.map((option) => option.name);
  if (value.type === "select") return value.select ? [value.select.name] : [];
  if (value.type === "status") return value.status ? [value.status.name] : [];
  const text = plainTextValue(value);
  return text === "" ? [] : [text];
}

const fold = (text: string) => text.trim().toLowerCase();

/** Whole days, so "đúng ngày" matches a date regardless of the time on it. */
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;

export function matchesFilter(page: PageObjectResponse, filter: Filter): boolean {
  const value = propertyOf(page, filter.propertyId);
  const strings = stringsOf(value);
  const needle = fold(filter.value ?? "");

  switch (filter.operator) {
    case "empty":
      return strings.length === 0;
    case "not_empty":
      return strings.length > 0;
    case "is_checked":
      return value?.type === "checkbox" ? value.checkbox : false;
    case "is_unchecked":
      return value?.type === "checkbox" ? !value.checkbox : false;
    case "contains":
      return strings.some((entry) => fold(entry).includes(needle));
    case "not_contains":
      return !strings.some((entry) => fold(entry).includes(needle));
    case "is":
      return strings.some((entry) => fold(entry) === needle);
    case "is_not":
      return !strings.some((entry) => fold(entry) === needle);
    default:
      break;
  }

  if (filter.operator === "on" || filter.operator === "before" || filter.operator === "after") {
    const actual = dateOf(value);
    const target = filter.value ? new Date(filter.value).getTime() : NaN;
    if (actual === null || !Number.isFinite(target)) return false;
    if (filter.operator === "on") return startOfDay(actual) === startOfDay(target);
    return filter.operator === "before" ? actual < target : actual > target;
  }

  const actual = numberOf(value);
  const target = Number(filter.value);
  if (actual === null || !Number.isFinite(target)) return false;
  switch (filter.operator) {
    case "eq":
      return actual === target;
    case "ne":
      return actual !== target;
    case "gt":
      return actual > target;
    case "gte":
      return actual >= target;
    case "lt":
      return actual < target;
    case "lte":
      return actual <= target;
    default:
      return true;
  }
}

/* ── Search ──────────────────────────────────────────────────────────────── */

/**
 * Substring match across every property's text form, so a search finds an item by its
 * genre or its studio and not only by its title.
 */
export function matchesSearch(page: PageObjectResponse, query: string): boolean {
  const needle = fold(query);
  if (needle === "") return true;
  return Object.values(page.properties).some((value) => fold(plainTextValue(value)).includes(needle));
}

/* ── Sort ────────────────────────────────────────────────────────────────── */

export type SortKey = { propertyId: string; direction: "asc" | "desc" };

/**
 * Moves one entry to another position, shifting the rest along. Kept here rather than in
 * the drag handler so the reordering itself can be reasoned about without a pointer.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Orders rows by each key in turn. Numbers and dates compare as themselves; everything else
 * compares as Vietnamese text. Empty values always sink to the bottom rather than sorting as
 * zero or as the empty string, because a blank is missing information, not a small value.
 */
export function sortPages(pages: PageObjectResponse[], keys: SortKey[]): PageObjectResponse[] {
  if (keys.length === 0) return pages;

  return [...pages].sort((left, right) => {
    for (const key of keys) {
      const a = propertyOf(left, key.propertyId);
      const b = propertyOf(right, key.propertyId);

      const aNum = numberOf(a) ?? dateOf(a);
      const bNum = numberOf(b) ?? dateOf(b);
      let comparison: number;

      if (aNum !== null && bNum !== null) {
        comparison = aNum - bNum;
      } else if (aNum !== null || bNum !== null) {
        // One side has no comparable value: it sorts last in either direction.
        return aNum === null ? 1 : -1;
      } else {
        const aText = stringsOf(a).join(", ");
        const bText = stringsOf(b).join(", ");
        if (aText === "" || bText === "") {
          if (aText === bText) continue;
          return aText === "" ? 1 : -1;
        }
        comparison = aText.localeCompare(bText, "vi");
      }

      if (comparison !== 0) return key.direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

/* ── Group ───────────────────────────────────────────────────────────────── */

export type PageGroup = { key: string; label: string; pages: PageObjectResponse[] };

export const UNGROUPED_LABEL = "Chưa có";

/**
 * Splits rows into labelled sections. A multi-select item appears under each of its values,
 * because hiding it under only the first would misrepresent the data.
 */
export function groupPages(pages: PageObjectResponse[], propertyId: string): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  const empty: PageObjectResponse[] = [];

  for (const page of pages) {
    const keys = stringsOf(propertyOf(page, propertyId));
    if (keys.length === 0) {
      empty.push(page);
      continue;
    }
    for (const key of keys) {
      const existing = groups.get(key);
      if (existing) existing.pages.push(page);
      else groups.set(key, { key, label: key, pages: [page] });
    }
  }

  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "vi"));
  if (empty.length) ordered.push({ key: "__none__", label: UNGROUPED_LABEL, pages: empty });
  return ordered;
}

/* ── URL encoding ────────────────────────────────────────────────────────── */

export type GalleryQuery = {
  search: string;
  filters: Filter[];
  sorts: SortKey[];
  groupBy: string | null;
};

export const EMPTY_QUERY: GalleryQuery = { search: "", filters: [], sorts: [], groupBy: null };

/**
 * Filters and sorts travel as JSON.
 *
 * A delimited format looked tidier until Notion property ids turned out to arrive
 * percent-encoded — `M%5BL%7B` for one of them — so hand-rolled encoding decoded twice and
 * silently matched nothing. JSON hands all escaping to URLSearchParams, which is the one
 * layer that already knows how.
 */
export function parseGalleryQuery(params: Record<string, string | string[] | undefined>): GalleryQuery {
  const single = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };

  // Malformed input is dropped rather than thrown: a truncated or hand-edited link should
  // still open the gallery, just with less applied to it.
  const readArray = (raw: string | undefined): unknown[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const filters: Filter[] = [];
  for (const entry of readArray(single("filter"))) {
    if (typeof entry !== "object" || entry === null) continue;
    const { p, o, v } = entry as { p?: unknown; o?: unknown; v?: unknown };
    if (typeof p !== "string" || typeof o !== "string") continue;
    filters.push({ propertyId: p, operator: o as FilterOperator, value: typeof v === "string" ? v : undefined });
  }

  const sorts: SortKey[] = [];
  for (const entry of readArray(single("sort"))) {
    if (typeof entry !== "object" || entry === null) continue;
    const { p, d } = entry as { p?: unknown; d?: unknown };
    if (typeof p !== "string") continue;
    sorts.push({ propertyId: p, direction: d === "desc" ? "desc" : "asc" });
  }

  return {
    search: single("q") ?? "",
    filters,
    sorts,
    groupBy: single("group") || null,
  };
}

export function serializeFilters(filters: Filter[]): string {
  if (filters.length === 0) return "";
  return JSON.stringify(
    filters.map((filter) => ({
      p: filter.propertyId,
      o: filter.operator,
      ...(filter.value ? { v: filter.value } : {}),
    })),
  );
}

export function serializeSorts(sorts: SortKey[]): string {
  if (sorts.length === 0) return "";
  return JSON.stringify(sorts.map((sort) => ({ p: sort.propertyId, d: sort.direction })));
}

/** Everything the toolbar does, in one pass, in the order a reader expects. */
export function applyGalleryQuery(pages: PageObjectResponse[], query: GalleryQuery): PageObjectResponse[] {
  let result = pages;
  if (query.search.trim() !== "") result = result.filter((page) => matchesSearch(page, query.search));
  for (const filter of query.filters) result = result.filter((page) => matchesFilter(page, filter));
  return sortPages(result, query.sorts);
}

export function isQueryActive(query: GalleryQuery): boolean {
  return query.search.trim() !== "" || query.filters.length > 0 || query.sorts.length > 0 || query.groupBy !== null;
}
