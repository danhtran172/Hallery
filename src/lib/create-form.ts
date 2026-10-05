/**
 * The quick-entry form for adding an item to a gallery.
 *
 * Which fields it shows and in what order is a CardLayout like the other two views, so the
 * same editor arranges all three. What it adds is per-field entry behaviour: whether the
 * field must be filled, and what it starts out holding.
 *
 * Creating a page writes values into a new row. It never touches the database's schema,
 * which is the line Hallery does not cross.
 */

/** Property types Hallery can write, and therefore the only ones a form can offer. */
export const FORM_FIELD_TYPES = new Set([
  "title",
  "rich_text",
  "number",
  "url",
  "email",
  "phone_number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "status",
]);

/** Notion gives every database's title property the id "title". */
export const TITLE_PROPERTY_ID = "title";

/** The form's pseudo-id for the title, as the card layout files it. */
const TITLE_LAYOUT_ID = "__title__";

/**
 * The input name for a form field: `field:<type>:<Notion property id>`. Ids rather than
 * names, so a property renamed in Notion after the form was drawn still gets its value.
 */
export function createFieldName(type: string, propertyId: string): string {
  return `field:${type}:${propertyId === TITLE_LAYOUT_ID ? TITLE_PROPERTY_ID : propertyId}`;
}

export type DefaultMode = "none" | "static" | "today" | "last";

export type FormFieldConfig = {
  required?: boolean;
  defaultMode?: DefaultMode;
  /** Used by the static mode. */
  defaultValue?: string;
};

export type FormDefaults = Record<string, FormFieldConfig>;

/** What the previous submission left in each field, for the copy-from-last mode. */
export type FormLastValues = Record<string, string>;

export const DEFAULT_MODE_LABELS: Record<DefaultMode, string> = {
  none: "Để trống",
  static: "Giá trị cố định",
  today: "Hôm nay",
  last: "Giữ như lần nhập trước",
};

/**
 * Modes that make sense for a type. "Today" only means something to a date, and carrying a
 * title over from the last entry would seed every new item with the previous one's name.
 */
export function defaultModesFor(propertyType: string): DefaultMode[] {
  if (propertyType === "date") return ["none", "today", "static", "last"];
  if (propertyType === "title") return ["none", "static"];
  return ["none", "static", "last"];
}

/** The value a field starts with, given its config and the previous submission. */
export function resolveDefaultValue(
  config: FormFieldConfig | undefined,
  propertyType: string,
  lastValues: FormLastValues,
  propertyId: string,
  today = new Date(),
): string {
  const mode = config?.defaultMode ?? "none";
  if (mode === "static") return config?.defaultValue ?? "";
  if (mode === "last") return lastValues[propertyId] ?? "";
  if (mode === "today" && propertyType === "date") {
    // The date input wants a plain yyyy-mm-dd in local time, not an ISO instant — going
    // through toISOString would shift the day for anyone east of UTC, which is everyone here.
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${today.getFullYear()}-${month}-${day}`;
  }
  return "";
}

export function parseFormDefaults(raw: unknown): FormDefaults {
  if (typeof raw !== "object" || raw === null) return {};
  const out: FormDefaults = {};
  for (const [propertyId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { required, defaultMode, defaultValue } = value as Record<string, unknown>;
    out[propertyId] = {
      required: required === true,
      defaultMode:
        defaultMode === "static" || defaultMode === "today" || defaultMode === "last"
          ? defaultMode
          : "none",
      ...(typeof defaultValue === "string" ? { defaultValue } : {}),
    };
  }
  return out;
}

export function parseFormLastValues(raw: unknown): FormLastValues {
  if (typeof raw !== "object" || raw === null) return {};
  const out: FormLastValues = {};
  for (const [propertyId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[propertyId] = value;
  }
  return out;
}
