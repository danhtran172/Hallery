/**
 * The property search shared by every property list in settings.
 *
 * Plain text matches a property's name. A leading "/" filters by type first: "/button"
 * (or "/nút") lists only the buttons, "/select" the selects, "/date ngày" the dates whose
 * name holds "ngày".
 */

const TYPE_ALIASES: Record<string, string> = {
  button: "button",
  btn: "button",
  nut: "button",
  "nút": "button",
};

export function parsePropertySearch(query: string): { type: string | null; text: string } {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return { type: null, text: trimmed };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  return { type: TYPE_ALIASES[head] ?? (head || null), text: rest.join(" ") };
}

export function matchesPropertySearch(
  property: { name: string; otherName?: string | null; type: string },
  query: string,
): boolean {
  const { type, text } = parsePropertySearch(query);
  if (type && !property.type.toLowerCase().startsWith(type)) return false;
  if (!text) return true;
  return property.name.toLowerCase().includes(text) || (property.otherName ?? "").toLowerCase().includes(text);
}

/** Buttons go last, in their own group: they act, where every other property holds a value. */
export function splitButtons<T>(items: T[], typeOf: (item: T) => string): { values: T[]; buttons: T[] } {
  return {
    values: items.filter((item) => typeOf(item) !== "button"),
    buttons: items.filter((item) => typeOf(item) === "button"),
  };
}

export const PROPERTY_SEARCH_PLACEHOLDER = "Tìm property · /button";
