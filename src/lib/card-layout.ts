/**
 * Which properties a gallery card shows, in what order, and whether each one carries its
 * field name. Stored inside Gallery.displayConfig so it travels with the rest of the
 * gallery's presentation settings.
 *
 * Separate from PropertyConfig.sortOrder on purpose: that is the property *inventory*
 * order, shared by Settings and the detail layout's default. What a card leads with is a
 * different question from how the property list is filed.
 */

export type CardField = { id: string; showLabel: boolean };
export type CardLayout = { fields: CardField[] };

/** How many properties a card shows when nothing has been configured yet. */
export const DEFAULT_CARD_FIELD_COUNT = 4;

export type CardEligibleProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  isMissing: boolean;
};

/** Properties a card is allowed to show — the title is already the card's heading. */
export function cardEligibleProperties<T extends CardEligibleProperty>(properties: T[]): T[] {
  return properties.filter((p) => p.notionPropertyType !== "title" && !p.isMissing);
}

export function parseCardLayout(raw: unknown): CardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fields = (raw as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return null;

  const parsed: CardField[] = [];
  for (const field of fields) {
    if (typeof field !== "object" || field === null) continue;
    const { id, showLabel } = field as { id?: unknown; showLabel?: unknown };
    if (typeof id !== "string" || id === "") continue;
    parsed.push({ id, showLabel: showLabel !== false });
  }
  return { fields: parsed };
}

/**
 * The fields a card should render, reconciled against the properties that currently exist.
 * Configured ids that have vanished from Notion are dropped rather than rendered blank;
 * with no configuration at all, falls back to the first few properties so a freshly added
 * gallery still shows something.
 */
export function resolveCardFields<T extends CardEligibleProperty>(
  layout: CardLayout | null,
  properties: T[],
): { property: T; showLabel: boolean }[] {
  const eligible = cardEligibleProperties(properties);

  if (!layout) {
    return eligible
      .slice(0, DEFAULT_CARD_FIELD_COUNT)
      .map((property) => ({ property, showLabel: true }));
  }

  const byId = new Map(eligible.map((property) => [property.notionPropertyId, property]));
  const resolved: { property: T; showLabel: boolean }[] = [];
  for (const field of layout.fields) {
    const property = byId.get(field.id);
    if (property) resolved.push({ property, showLabel: field.showLabel });
  }
  return resolved;
}
