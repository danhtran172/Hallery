/**
 * How a gallery card is arranged: where the cover sits relative to the properties, how
 * wide the card runs, which properties appear, and which of them are drawn over the cover.
 *
 * Stored inside Gallery.displayConfig, and kept separate from PropertyConfig.sortOrder on
 * purpose — that is the property *inventory* order, shared by Settings and the detail
 * layout's default. What a card leads with is a different question.
 */

export type CardField = { id: string; showLabel: boolean };

export const CARD_PRESETS = ["stack", "beside"] as const;
export type CardPreset = (typeof CARD_PRESETS)[number];

/** Columns of the gallery grid a card occupies. */
export type CardSpan = 1 | 2;

export type CardLayout = {
  preset: CardPreset;
  span: CardSpan;
  fields: CardField[];
  /** Drawn on top of the cover. Capped — a cover crowded with text stops being an image. */
  overlayFields: CardField[];
};

export const MAX_OVERLAY_FIELDS = 3;

/** How many properties a card shows when nothing has been configured yet. */
export const DEFAULT_CARD_FIELD_COUNT = 4;

export type PresetOption = {
  value: CardPreset;
  label: string;
  hint: string;
  defaultSpan: CardSpan;
};

/**
 * Which arrangements make sense for a cover shape. A tall cover beside its text reads
 * like a book listing; the same cover above its text makes a very tall card, so the
 * defaults differ even though both arrangements are offered.
 */
export function presetsFor(coverAspect: string | undefined): PresetOption[] {
  if (coverAspect === "none") {
    return [{ value: "stack", label: "Chỉ có chữ", hint: "Card không có ảnh bìa.", defaultSpan: 1 }];
  }

  const beside: PresetOption = {
    value: "beside",
    label: "Ảnh bên trái",
    hint: "Ảnh một bên, thông tin bên cạnh. Hợp với card rộng.",
    defaultSpan: 2,
  };

  if (coverAspect === "portrait") {
    return [
      { ...beside, hint: "Ảnh dọc bên trái, thông tin bên phải — kiểu bìa sách." },
      { value: "stack", label: "Ảnh trên", hint: "Ảnh dọc phía trên, thông tin bên dưới. Card sẽ khá cao.", defaultSpan: 1 },
    ];
  }

  return [
    { value: "stack", label: "Ảnh trên", hint: "Ảnh phía trên, thông tin bên dưới.", defaultSpan: 1 },
    beside,
  ];
}

export function isPreset(value: unknown): value is CardPreset {
  return typeof value === "string" && (CARD_PRESETS as readonly string[]).includes(value);
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

export function parseCardLayout(raw: unknown): CardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { preset, span, fields, overlayFields } = raw as Record<string, unknown>;

  return {
    preset: isPreset(preset) ? preset : "stack",
    span: span === 2 ? 2 : 1,
    fields: parseFields(fields),
    overlayFields: parseFields(overlayFields).slice(0, MAX_OVERLAY_FIELDS),
  };
}

export type ResolvedCardField<T> = { property: T; showLabel: boolean };

export type ResolvedCardLayout<T> = {
  preset: CardPreset;
  span: CardSpan;
  fields: ResolvedCardField<T>[];
  overlayFields: ResolvedCardField<T>[];
};

/**
 * The arrangement a card should render, reconciled against the properties that exist now.
 * Configured ids whose property has vanished from Notion are dropped rather than rendered
 * blank; with no configuration at all, falls back to the first few properties stacked
 * under the cover, which is what galleries looked like before this was configurable.
 */
export function resolveCardLayout<T extends CardEligibleProperty>(
  layout: CardLayout | null,
  properties: T[],
  coverAspect: string | undefined,
): ResolvedCardLayout<T> {
  const eligible = cardEligibleProperties(properties);
  const byId = new Map(eligible.map((property) => [property.notionPropertyId, property]));

  const pick = (fields: CardField[], taken: Set<string>): ResolvedCardField<T>[] => {
    const resolved: ResolvedCardField<T>[] = [];
    for (const field of fields) {
      const property = byId.get(field.id);
      if (!property || taken.has(field.id)) continue;
      taken.add(field.id);
      resolved.push({ property, showLabel: field.showLabel });
    }
    return resolved;
  };

  if (!layout) {
    return {
      preset: "stack",
      span: 1,
      fields: eligible.slice(0, DEFAULT_CARD_FIELD_COUNT).map((property) => ({ property, showLabel: true })),
      overlayFields: [],
    };
  }

  // A property can only be in one place; overlay wins so a stale body entry can't duplicate it.
  const taken = new Set<string>();
  const allowOverlay = coverAspect !== "none";
  const overlayFields = allowOverlay ? pick(layout.overlayFields, taken).slice(0, MAX_OVERLAY_FIELDS) : [];
  const fields = pick(layout.fields, taken);

  const validPresets = presetsFor(coverAspect).map((option) => option.value);
  const preset = validPresets.includes(layout.preset) ? layout.preset : validPresets[0];

  return { preset, span: layout.span, fields, overlayFields };
}
