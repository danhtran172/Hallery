/** Property types Hallery can write back to Notion in Phase 1 (plain values, no rich formatting). */
export const EDITABLE_PROPERTY_TYPES = new Set([
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

/** Notion-enforced read-only: no workaround exists, ever (see blueprint A.2). */
export const READONLY_PROPERTY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "button",
  "verification",
  "place",
]);

type NotionPropertyUpdate = Record<string, unknown>;

/** Reads one field out of FormData for a given property type and builds the Notion pages.update payload for it. */
export function buildPropertyUpdate(
  type: string,
  formData: FormData,
  fieldName: string,
): NotionPropertyUpdate | null {
  if (!EDITABLE_PROPERTY_TYPES.has(type)) return null;

  switch (type) {
    case "title":
    case "rich_text": {
      const value = String(formData.get(fieldName) ?? "");
      return { [type]: value ? [{ text: { content: value } }] : [] };
    }
    case "number": {
      const raw = String(formData.get(fieldName) ?? "").trim();
      return { number: raw === "" ? null : Number(raw) };
    }
    case "url":
    case "email":
    case "phone_number": {
      const value = String(formData.get(fieldName) ?? "").trim();
      return { [type]: value === "" ? null : value };
    }
    case "checkbox": {
      return { checkbox: formData.get(fieldName) === "on" };
    }
    case "date": {
      const value = String(formData.get(fieldName) ?? "").trim();
      return { date: value === "" ? null : { start: value } };
    }
    case "select":
    case "status": {
      const value = String(formData.get(fieldName) ?? "").trim();
      return { [type]: value === "" ? null : { name: value } };
    }
    case "multi_select": {
      const raw = String(formData.get(fieldName) ?? "");
      const names = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { multi_select: names.map((name) => ({ name })) };
    }
    default:
      return null;
  }
}
