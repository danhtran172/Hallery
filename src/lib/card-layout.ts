/**
 * How a gallery card is arranged, in two layers.
 *
 *   Layer 1 — where the boxes sit relative to the cover image.
 *   Layer 2 — how the properties inside each box are laid out.
 *
 * Both are picked from pictures rather than words, the way the Card Detail builder does
 * it. Stored in Gallery.displayConfig; property references are Notion property IDs, so a
 * rename in Notion cannot break a saved arrangement.
 */

export const CARD_LAYOUT_VERSION = 3;

export type CardField = { id: string; showLabel: boolean };

/* ── Layer 1 ─────────────────────────────────────────────────────────────── */

export type CoverSlot = "top" | "left" | "right" | "full" | "none";

export type Arrangement = {
  label: string;
  cover: CoverSlot;
  /** Boxes this arrangement exposes, in visual order. */
  cells: string[];
};

export const ARRANGEMENTS = {
  "cover-top": { label: "Ảnh trên", cover: "top", cells: ["a"] },
  "cover-top-two": { label: "Ảnh trên, 2 ô", cover: "top", cells: ["a", "b"] },
  "cover-left": { label: "Ảnh trái", cover: "left", cells: ["a"] },
  "cover-left-below": { label: "Ảnh trái, thêm ô dưới", cover: "left", cells: ["a", "b"] },
  "cover-right": { label: "Ảnh phải", cover: "right", cells: ["a"] },
  "cover-only": { label: "Chỉ ảnh", cover: "full", cells: [] },
  "no-cover": { label: "Không ảnh", cover: "none", cells: ["a"] },
} as const satisfies Record<string, Arrangement>;

export type ArrangementId = keyof typeof ARRANGEMENTS;
export const ARRANGEMENT_IDS = Object.keys(ARRANGEMENTS) as ArrangementId[];

export function isArrangement(value: unknown): value is ArrangementId {
  return typeof value === "string" && value in ARRANGEMENTS;
}

/* ── Layer 2 ─────────────────────────────────────────────────────────────── */

export const CELL_DISPLAYS = {
  rows: { label: "Nhãn trái, giá trị phải" },
  stacked: { label: "Nhãn trên, giá trị dưới" },
  "two-col": { label: "Hai cột" },
  inline: { label: "Nối liền một hàng" },
} as const;

export type CellDisplay = keyof typeof CELL_DISPLAYS;
export const CELL_DISPLAY_IDS = Object.keys(CELL_DISPLAYS) as CellDisplay[];

export function isCellDisplay(value: unknown): value is CellDisplay {
  return typeof value === "string" && value in CELL_DISPLAYS;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

export type CardRatio = [30, 70] | [40, 60] | [50, 50] | [60, 40] | [70, 30];
export const CARD_RATIOS: CardRatio[] = [
  [30, 70],
  [40, 60],
  [50, 50],
  [60, 40],
  [70, 30],
];

export type CardSpan = 1 | 2;
export type CardCell = { display: CellDisplay; fields: CardField[] };

export type CardLayout = {
  version: typeof CARD_LAYOUT_VERSION;
  arrangement: ArrangementId;
  span: CardSpan;
  /** Cover vs text split, used when the cover sits on a side. */
  ratio: CardRatio;
  /** Burned onto the cover. Capped — a cover buried under text stops being an image. */
  overlay: CardField[];
  cells: Record<string, CardCell>;
};

export const MAX_OVERLAY_FIELDS = 3;
export const DEFAULT_CARD_FIELD_COUNT = 4;

export type CardEligibleProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  isMissing: boolean;
};

/** Properties a card may show — the title is already the card's heading. */
export function cardEligibleProperties<T extends CardEligibleProperty>(properties: T[]): T[] {
  return properties.filter((p) => p.notionPropertyType !== "title" && !p.isMissing);
}

const emptyCell = (): CardCell => ({ display: "rows", fields: [] });

export function createDefaultCardLayout(properties: CardEligibleProperty[]): CardLayout {
  const fields = cardEligibleProperties(properties)
    .slice(0, DEFAULT_CARD_FIELD_COUNT)
    .map((property) => ({ id: property.notionPropertyId, showLabel: true }));

  return {
    version: CARD_LAYOUT_VERSION,
    arrangement: "cover-top",
    span: 1,
    ratio: [40, 60],
    overlay: [],
    cells: { a: { display: "rows", fields } },
  };
}

function parseFields(raw: unknown): CardField[] {
  if (!Array.isArray(raw)) return [];
  const fields: CardField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, showLabel } = entry as { id?: unknown; showLabel?: unknown };
    if (typeof id !== "string" || id === "") continue;
    fields.push({ id, showLabel: showLabel !== false });
  }
  return fields;
}

function parseRatio(raw: unknown): CardRatio {
  if (Array.isArray(raw) && raw.length === 2) {
    const match = CARD_RATIOS.find((ratio) => ratio[0] === raw[0] && ratio[1] === raw[1]);
    if (match) return match;
  }
  return [40, 60];
}

function parseCell(raw: unknown): CardCell {
  if (typeof raw !== "object" || raw === null) return emptyCell();
  const { display, fields } = raw as { display?: unknown; fields?: unknown };
  return { display: isCellDisplay(display) ? display : "rows", fields: parseFields(fields) };
}

/**
 * Reads persisted JSON. Earlier shapes are lifted rather than discarded, so a gallery
 * keeps the arrangement someone already set instead of silently resetting to defaults.
 */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== CARD_LAYOUT_VERSION) return liftLegacyLayout(value);

  const arrangement = isArrangement(value.arrangement) ? value.arrangement : "cover-top";
  const cellsRaw = (value.cells ?? {}) as Record<string, unknown>;
  const cells: Record<string, CardCell> = {};
  for (const id of ARRANGEMENTS[arrangement].cells) cells[id] = parseCell(cellsRaw[id]);

  return {
    version: CARD_LAYOUT_VERSION,
    arrangement,
    span: value.span === 2 ? 2 : 1,
    ratio: parseRatio(value.ratio),
    overlay: parseFields(value.overlay).slice(0, MAX_OVERLAY_FIELDS),
    cells,
  };
}

/** v1: `{ preset, fields, overlayFields }`. v2: `{ cover, side, below: { cells } }`. */
function liftLegacyLayout(value: Record<string, unknown>): CardLayout | null {
  const overlay = parseFields(value.overlay ?? value.overlayFields).slice(0, MAX_OVERLAY_FIELDS);
  const span: CardSpan = value.span === 2 ? 2 : 1;
  const base = { version: CARD_LAYOUT_VERSION, span, ratio: parseRatio(value.ratio), overlay } as const;

  if ("below" in value) {
    const below = (value.below ?? {}) as Record<string, unknown>;
    const belowCells = Array.isArray(below.cells) ? below.cells : [];
    const side = parseFields(value.side);
    const first = parseFields(belowCells[0]);
    const second = parseFields(belowCells[1]);

    if (value.cover === "left") {
      const rest = [...first, ...second];
      return rest.length
        ? { ...base, arrangement: "cover-left-below", cells: { a: { display: "rows", fields: side }, b: { display: "rows", fields: rest } } }
        : { ...base, arrangement: "cover-left", cells: { a: { display: "rows", fields: side } } };
    }
    if (value.cover === "off") {
      return { ...base, arrangement: "no-cover", overlay: [], cells: { a: { display: "rows", fields: [...side, ...first, ...second] } } };
    }
    return second.length
      ? { ...base, arrangement: "cover-top-two", cells: { a: { display: "rows", fields: first }, b: { display: "rows", fields: second } } }
      : { ...base, arrangement: "cover-top", cells: { a: { display: "rows", fields: [...side, ...first] } } };
  }

  if ("preset" in value || "fields" in value) {
    const fields = parseFields(value.fields);
    return value.preset === "beside"
      ? { ...base, arrangement: "cover-left", cells: { a: { display: "rows", fields } } }
      : { ...base, arrangement: "cover-top", cells: { a: { display: "rows", fields } } };
  }

  return null;
}

/* ── Resolution ──────────────────────────────────────────────────────────── */

export type ResolvedField<T> = { property: T; showLabel: boolean };
export type ResolvedCell<T> = { id: string; display: CellDisplay; fields: ResolvedField<T>[] };

export type ResolvedCardLayout<T> = {
  arrangement: ArrangementId;
  cover: CoverSlot;
  span: CardSpan;
  ratio: CardRatio;
  overlay: ResolvedField<T>[];
  cells: ResolvedCell<T>[];
};

/**
 * The arrangement to render, reconciled against the properties that exist now. Ids whose
 * property has vanished from Notion are dropped rather than rendered blank, and a
 * property claimed twice is kept only where it appears first.
 */
export function resolveCardLayout<T extends CardEligibleProperty>(
  layout: CardLayout | null,
  properties: T[],
  coverAspect: string | undefined,
): ResolvedCardLayout<T> {
  const eligible = cardEligibleProperties(properties);
  const byId = new Map(eligible.map((property) => [property.notionPropertyId, property]));
  const source = layout ?? createDefaultCardLayout(properties);

  // A gallery with covers switched off cannot show one, whatever the arrangement says.
  const arrangement: ArrangementId =
    coverAspect === "none" && ARRANGEMENTS[source.arrangement].cover !== "none"
      ? "no-cover"
      : source.arrangement;
  const spec = ARRANGEMENTS[arrangement];

  const taken = new Set<string>();
  const pick = (fields: CardField[], limit?: number): ResolvedField<T>[] => {
    const resolved: ResolvedField<T>[] = [];
    for (const field of fields) {
      if (limit !== undefined && resolved.length >= limit) break;
      const property = byId.get(field.id);
      if (!property || taken.has(field.id)) continue;
      taken.add(field.id);
      resolved.push({ property, showLabel: field.showLabel });
    }
    return resolved;
  };

  const overlay = spec.cover === "none" ? [] : pick(source.overlay, MAX_OVERLAY_FIELDS);
  const cells: ResolvedCell<T>[] = spec.cells.map((id) => {
    const cell = source.cells[id] ?? emptyCell();
    return { id, display: cell.display, fields: pick(cell.fields) };
  });

  return { arrangement, cover: spec.cover, span: source.span, ratio: source.ratio, overlay, cells };
}
