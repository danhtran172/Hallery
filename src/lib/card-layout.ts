/**
 * How a gallery card is arranged.
 *
 * Mirrors the Card Detail builder's shape — regions holding ordered properties, a split
 * with a ratio — but stops well short of its depth. A card is a thumbnail: the useful
 * choices are where the cover sits, what sits next to it, what runs underneath, and what
 * is burned onto the image itself.
 *
 * Stored in Gallery.displayConfig. Property references are Notion property IDs, so a
 * rename in Notion cannot break a saved arrangement.
 */

export const CARD_LAYOUT_VERSION = 2;

export type CardField = { id: string; showLabel: boolean };

/** Where the cover sits relative to the text. */
export const COVER_PLACEMENTS = ["top", "left", "off"] as const;
export type CoverPlacement = (typeof COVER_PLACEMENTS)[number];

/** How the region under the cover row is divided. */
export const BELOW_KINDS = ["single", "two-col"] as const;
export type BelowKind = (typeof BELOW_KINDS)[number];

export type CardRatio = [30, 70] | [40, 60] | [50, 50] | [60, 40] | [70, 30];
export const CARD_RATIOS: CardRatio[] = [
  [30, 70],
  [40, 60],
  [50, 50],
  [60, 40],
  [70, 30],
];

export type CardSpan = 1 | 2;

export type CardBelow = {
  kind: BelowKind;
  ratio: CardRatio;
  /** One list for "single", two for "two-col". */
  cells: CardField[][];
};

export type CardLayout = {
  version: typeof CARD_LAYOUT_VERSION;
  cover: CoverPlacement;
  span: CardSpan;
  /** Cover vs side split, used only when the cover is on the left. */
  ratio: CardRatio;
  /** Burned onto the cover. Capped — a cover buried under text stops being an image. */
  overlay: CardField[];
  /** Beside the cover. Only reachable when the cover is on the left. */
  side: CardField[];
  below: CardBelow;
};

export const MAX_OVERLAY_FIELDS = 3;
export const DEFAULT_CARD_FIELD_COUNT = 4;

export type CardZone = "overlay" | "side" | "below-0" | "below-1" | "tray";

/** Zones a given arrangement actually exposes, in visual order. */
export function activeZones(layout: { cover: CoverPlacement; below: { kind: BelowKind } }): CardZone[] {
  const zones: CardZone[] = [];
  if (layout.cover !== "off") zones.push("overlay");
  if (layout.cover === "left") zones.push("side");
  zones.push("below-0");
  if (layout.below.kind === "two-col") zones.push("below-1");
  return zones;
}

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

export function createDefaultCardLayout(properties: CardEligibleProperty[]): CardLayout {
  const fields = cardEligibleProperties(properties)
    .slice(0, DEFAULT_CARD_FIELD_COUNT)
    .map((property) => ({ id: property.notionPropertyId, showLabel: true }));

  return {
    version: CARD_LAYOUT_VERSION,
    cover: "top",
    span: 1,
    ratio: [40, 60],
    overlay: [],
    side: [],
    below: { kind: "single", ratio: [50, 50], cells: [fields] },
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

/**
 * Reads persisted JSON. Version 1 stored a flat preset plus one field list; it is lifted
 * into the region shape rather than discarded, so an existing gallery keeps its
 * arrangement instead of silently resetting.
 */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  if (value.version !== CARD_LAYOUT_VERSION) return liftLegacyLayout(value);

  const belowRaw = (value.below ?? {}) as Record<string, unknown>;
  const kind: BelowKind = belowRaw.kind === "two-col" ? "two-col" : "single";
  const cellsRaw = Array.isArray(belowRaw.cells) ? belowRaw.cells : [];
  const cells = kind === "two-col"
    ? [parseFields(cellsRaw[0]), parseFields(cellsRaw[1])]
    : [parseFields(cellsRaw[0])];

  return {
    version: CARD_LAYOUT_VERSION,
    cover: COVER_PLACEMENTS.includes(value.cover as CoverPlacement) ? (value.cover as CoverPlacement) : "top",
    span: value.span === 2 ? 2 : 1,
    ratio: parseRatio(value.ratio),
    overlay: parseFields(value.overlay).slice(0, MAX_OVERLAY_FIELDS),
    side: parseFields(value.side),
    below: { kind, ratio: parseRatio(belowRaw.ratio), cells },
  };
}

/** Version 1: `{ preset: "stack" | "beside", span, fields, overlayFields }`. */
function liftLegacyLayout(value: Record<string, unknown>): CardLayout | null {
  if (!("preset" in value) && !("fields" in value)) return null;
  const beside = value.preset === "beside";
  const fields = parseFields(value.fields);

  return {
    version: CARD_LAYOUT_VERSION,
    cover: beside ? "left" : "top",
    span: value.span === 2 ? 2 : 1,
    ratio: [40, 60],
    overlay: parseFields(value.overlayFields).slice(0, MAX_OVERLAY_FIELDS),
    // Beside used to put every field next to the cover; keep them there.
    side: beside ? fields : [],
    below: { kind: "single", ratio: [50, 50], cells: [beside ? [] : fields] },
  };
}

export type ResolvedField<T> = { property: T; showLabel: boolean };

export type ResolvedCardLayout<T> = {
  cover: CoverPlacement;
  span: CardSpan;
  ratio: CardRatio;
  overlay: ResolvedField<T>[];
  side: ResolvedField<T>[];
  below: { kind: BelowKind; ratio: CardRatio; cells: ResolvedField<T>[][] };
};

/**
 * The arrangement to render, reconciled against the properties that exist now. Ids whose
 * property has vanished from Notion are dropped rather than rendered blank, and a
 * property claimed by two zones is kept only in the first — zones are read in visual
 * order so the winner is the one nearest the top of the card.
 */
export function resolveCardLayout<T extends CardEligibleProperty>(
  layout: CardLayout | null,
  properties: T[],
  coverAspect: string | undefined,
): ResolvedCardLayout<T> {
  const eligible = cardEligibleProperties(properties);
  const byId = new Map(eligible.map((property) => [property.notionPropertyId, property]));
  const source = layout ?? createDefaultCardLayout(properties);

  // A gallery with covers switched off cannot show anything on or beside one.
  const cover: CoverPlacement = coverAspect === "none" ? "off" : source.cover === "off" ? "top" : source.cover;

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

  const overlay = cover === "off" ? [] : pick(source.overlay, MAX_OVERLAY_FIELDS);
  const side = cover === "left" ? pick(source.side) : [];
  const cells = source.below.cells.map((cell) => pick(cell));

  return {
    cover,
    span: source.span,
    ratio: source.ratio,
    overlay,
    side,
    below: { kind: source.below.kind, ratio: source.below.ratio, cells },
  };
}
