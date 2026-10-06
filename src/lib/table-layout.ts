import { TITLE_FIELD_ID, cardEligibleProperties, gridFields, type CardEligibleProperty, type CardLayout } from "@/lib/card-layout";
import type { DisplayConfig } from "@/lib/display-config";

/**
 * How a view lays its items out. A Gallery of cards is the default; a table trades the
 * pictures for one line per item and a column per property, for scanning and comparing.
 */
export type ViewType = "gallery" | "table";

export function parseViewType(value: unknown): ViewType {
  return value === "table" ? "table" : "gallery";
}

/** The cover picture as a column of its own — a pseudo-property, like the title. */
export const COVER_COLUMN_ID = "__cover__";

export type ColumnAlign = "left" | "center" | "right";
/** A column's own line-wrapping; absent follows the table. */
export type ColumnWrap = "wrap" | "clip";

/** One table column: a property id (or TITLE_FIELD_ID / COVER_COLUMN_ID) and how it shows. */
export type TableColumn = {
  id: string;
  width: number;
  /** Header text for this table only; absent uses the property's Hallery name. */
  label?: string;
  align?: ColumnAlign;
  wrap?: ColumnWrap;
  /**
   * Formatting for this table only. Absent: the property's own display config (the one
   * the card editor sets), so a table that was never touched reads like the cards.
   */
  display?: DisplayConfig;
};

export type CoverPlacement = "none" | "title" | "column";
export type ThumbShape = "square" | "circle" | "landscape" | "portrait";
export type ThumbSize = "sm" | "md" | "lg";
export type TableDensity = "compact" | "normal" | "roomy";

export type TableCover = { placement: CoverPlacement; shape: ThumbShape; size: ThumbSize };

/** A table view's own settings, stored next to `card` in the view's layoutConfig. */
export type TableLayout = {
  /** Shown columns, left to right. Always holds the title; holds the cover only when placed as a column. */
  columns: TableColumn[];
  /** Long values wrap onto more lines instead of being cut at one. Columns may override. */
  wrap: boolean;
  cover: TableCover;
  density: TableDensity;
  /** Columns up to and including the title stay put while the rest scrolls sideways. */
  stickyTitle: boolean;
  /** A running number before the first column. */
  rowNumbers: boolean;
  /** Every other row tinted. */
  stripes: boolean;
};

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 640;
export const DEFAULT_TITLE_WIDTH = 280;
export const DEFAULT_COLUMN_WIDTH = 180;
export const ROW_NUMBER_WIDTH = 44;
/** Columns a fresh table opens with when the view's card names none — 22 at once is a wall. */
const DEFAULT_COLUMN_COUNT = 6;

/** Thumbnail height per size, px. Width follows the shape. */
export const THUMB_HEIGHT: Record<ThumbSize, number> = { sm: 24, md: 36, lg: 56 };
export const THUMB_RATIO: Record<ThumbShape, [number, number]> = {
  square: [1, 1],
  circle: [1, 1],
  landscape: [16, 9],
  portrait: [3, 4],
};

export function thumbBox(cover: Pick<TableCover, "shape" | "size">): { width: number; height: number; ratio: string } {
  const [w, h] = THUMB_RATIO[cover.shape];
  const height = THUMB_HEIGHT[cover.size];
  return { width: Math.round((height * w) / h), height, ratio: `${w} / ${h}` };
}

/** A cover column is as wide as its picture plus the cell's padding — not dragged by hand. */
export function coverColumnWidth(cover: Pick<TableCover, "shape" | "size">): number {
  return thumbBox(cover).width + 24;
}

export const DEFAULT_COVER: TableCover = { placement: "title", shape: "square", size: "md" };

export function clampColumnWidth(value: unknown, fallback = DEFAULT_COLUMN_WIDTH): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)))
    : fallback;
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Only the formatting keys a table may override, as plain values. */
function parseColumnDisplay(raw: unknown): DisplayConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const display: DisplayConfig = {};
  if (typeof source.kind === "string") display.kind = source.kind.slice(0, 40);
  if (typeof source.max === "number" && Number.isFinite(source.max)) display.max = Math.min(10, Math.max(1, Math.round(source.max)));
  for (const key of ["prefix", "suffix", "label"] as const) {
    if (typeof source[key] === "string") display[key] = (source[key] as string).slice(0, 60);
  }
  return display;
}

function parseColumn(entry: unknown): TableColumn | null {
  if (typeof entry !== "object" || entry === null) return null;
  const source = entry as Record<string, unknown>;
  const id = source.id;
  if (typeof id !== "string" || !id) return null;
  const column: TableColumn = {
    id,
    width: clampColumnWidth(source.width, id === TITLE_FIELD_ID ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH),
  };
  if (typeof source.label === "string" && source.label.trim()) column.label = source.label.trim().slice(0, 80);
  if (source.align === "center" || source.align === "right") column.align = source.align;
  if (source.wrap === "wrap" || source.wrap === "clip") column.wrap = source.wrap;
  const display = parseColumnDisplay(source.display);
  if (display) column.display = display;
  return column;
}

/** Reads stored JSON leniently; null when there is nothing usable, so callers fall back. */
export function parseTableLayout(raw: unknown): TableLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.columns)) return null;
  const seen = new Set<string>();
  const columns: TableColumn[] = [];
  for (const entry of source.columns) {
    const column = parseColumn(entry);
    if (!column || seen.has(column.id)) continue;
    seen.add(column.id);
    columns.push(column);
  }
  if (!seen.has(TITLE_FIELD_ID)) columns.unshift({ id: TITLE_FIELD_ID, width: DEFAULT_TITLE_WIDTH });

  // The first table layouts only had `thumbnail: boolean` — a picture in the title cell.
  const rawCover = typeof source.cover === "object" && source.cover !== null ? (source.cover as Record<string, unknown>) : null;
  const cover: TableCover = rawCover
    ? {
        placement: oneOf(rawCover.placement, ["none", "title", "column"] as const, "title"),
        shape: oneOf(rawCover.shape, ["square", "circle", "landscape", "portrait"] as const, "square"),
        size: oneOf(rawCover.size, ["sm", "md", "lg"] as const, "md"),
      }
    : { ...DEFAULT_COVER, placement: source.thumbnail === false ? "none" : "title" };
  // The cover column exists exactly when the cover is placed as one.
  const hasCoverColumn = columns.some((column) => column.id === COVER_COLUMN_ID);
  if (cover.placement === "column" && !hasCoverColumn) {
    columns.splice(columns.findIndex((column) => column.id === TITLE_FIELD_ID), 0, { id: COVER_COLUMN_ID, width: 0 });
  }
  const finalColumns =
    cover.placement === "column" ? columns : columns.filter((column) => column.id !== COVER_COLUMN_ID);

  return {
    columns: finalColumns,
    wrap: source.wrap === true,
    cover,
    density: oneOf(source.density, ["compact", "normal", "roomy"] as const, "normal"),
    stickyTitle: source.stickyTitle === true,
    rowNumbers: source.rowNumbers === true,
    stripes: source.stripes === true,
  };
}

/**
 * The table a view opens with before anyone arranged one: the title, then what the view's
 * card already shows — the owner's own pick of what matters — or the first few properties
 * when the card names none.
 */
export function createDefaultTableLayout(properties: CardEligibleProperty[], card: CardLayout | null): TableLayout {
  const eligible = new Set(cardEligibleProperties(properties).map((p) => p.notionPropertyId));
  const fromCard = card
    ? [...Object.values(card.regions).flatMap((grid) => gridFields(grid)), ...card.overlay]
        .map((field) => field.id)
        .filter((id, index, all) => eligible.has(id) && all.indexOf(id) === index)
    : [];
  const ids = fromCard.length
    ? fromCard
    : cardEligibleProperties(properties)
        .slice(0, DEFAULT_COLUMN_COUNT)
        .map((p) => p.notionPropertyId);
  return {
    columns: [
      { id: TITLE_FIELD_ID, width: DEFAULT_TITLE_WIDTH },
      ...ids.map((id) => ({ id, width: DEFAULT_COLUMN_WIDTH })),
    ],
    wrap: false,
    cover: { ...DEFAULT_COVER },
    density: "normal",
    stickyTitle: false,
    rowNumbers: false,
    stripes: false,
  };
}

export type ResolvedTableColumn<T> = TableColumn & { property: T | null; isTitle: boolean; isCover: boolean };

/**
 * Stored columns matched to properties Hallery still manages. A column whose property was
 * switched off or left Notion drops out rather than drawing an empty column. The cover
 * column takes its width from the picture.
 */
export function resolveTableColumns<T extends CardEligibleProperty>(layout: TableLayout, properties: T[]): ResolvedTableColumn<T>[] {
  const byId = new Map(cardEligibleProperties(properties).map((p) => [p.notionPropertyId, p]));
  return layout.columns.flatMap((column): ResolvedTableColumn<T>[] => {
    if (column.id === TITLE_FIELD_ID) return [{ ...column, property: null, isTitle: true, isCover: false }];
    if (column.id === COVER_COLUMN_ID) {
      return layout.cover.placement === "column"
        ? [{ ...column, width: coverColumnWidth(layout.cover), property: null, isTitle: false, isCover: true }]
        : [];
    }
    const property = byId.get(column.id);
    return property ? [{ ...column, property, isTitle: false, isCover: false }] : [];
  });
}

/** How many leading columns stay fixed: through the title, when the table asks for it. */
export function stickyColumnCount(layout: Pick<TableLayout, "stickyTitle">, columns: { isTitle: boolean }[]): number {
  if (!layout.stickyTitle) return 0;
  return columns.findIndex((column) => column.isTitle) + 1;
}

/*
 * Column widths travel as CSS variables (--w0, --w1 …) set once on the table, so rows
 * rendered on the server follow a header dragged on the client without re-rendering.
 */

/** The grid tracks for a row: an optional number column, then one variable per column. */
export function tableTracks(columnCount: number, rowNumbers: boolean): string {
  const tracks = Array.from({ length: columnCount }, (_, index) => `var(--w${index})`);
  return [...(rowNumbers ? [`${ROW_NUMBER_WIDTH}px`] : []), ...tracks].join(" ");
}

/** The variables themselves, for the table's style attribute. */
export function widthVariables(widths: number[]): Record<string, string> {
  return Object.fromEntries(widths.map((width, index) => [`--w${index}`, `${width}px`]));
}

/** Where a fixed column sits: everything before it, added up. */
export function stickyLeft(index: number, rowNumbers: boolean): string {
  const parts = [`${rowNumbers ? ROW_NUMBER_WIDTH : 0}px`, ...Array.from({ length: index }, (_, i) => `var(--w${i})`)];
  return parts.length === 1 ? parts[0] : `calc(${parts.join(" + ")})`;
}
