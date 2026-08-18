import type { PageObjectResponse } from "@notionhq/client";

type PropertyValue = PageObjectResponse["properties"][string];

/**
 * Plain-text rendering of a property value, for places that need a preview string rather
 * than the styled output of `PropertyValue` — settings previews, and anywhere a value has
 * to fit in an attribute or a single line.
 */
export function plainTextValue(value: PropertyValue): string {
  switch (value.type) {
    case "title":
      return value.title.map((t) => t.plain_text).join("");
    case "rich_text":
      return value.rich_text.map((t) => t.plain_text).join("");
    case "number":
      return value.number === null ? "" : String(value.number);
    case "select":
      return value.select?.name ?? "";
    case "status":
      return value.status?.name ?? "";
    case "multi_select":
      return value.multi_select.map((option) => option.name).join(", ");
    case "date":
      return value.date ? new Date(value.date.start).toLocaleDateString("vi-VN") : "";
    case "checkbox":
      return value.checkbox ? "✓" : "—";
    case "url":
      return value.url ?? "";
    case "email":
      return value.email ?? "";
    case "phone_number":
      return value.phone_number ?? "";
    case "people":
      return value.people.map((person) => ("name" in person ? (person.name ?? "?") : "?")).join(", ");
    case "files":
      return value.files.length ? `${value.files.length} tệp` : "";
    case "relation":
      return value.relation.length ? `${value.relation.length} liên kết` : "";
    case "created_time":
      return new Date(value.created_time).toLocaleDateString("vi-VN");
    case "last_edited_time":
      return new Date(value.last_edited_time).toLocaleDateString("vi-VN");
    case "unique_id":
      return `${value.unique_id.prefix ? `${value.unique_id.prefix}-` : ""}${value.unique_id.number}`;
    case "formula":
      return formulaText(value.formula);
    case "rollup":
      return rollupText(value.rollup);
    default:
      return "";
  }
}

function formulaText(formula: { type: string; [key: string]: unknown }): string {
  if (formula.type === "string") return (formula.string as string | null) ?? "";
  if (formula.type === "number") return formula.number === null ? "" : String(formula.number);
  if (formula.type === "boolean") return formula.boolean ? "✓" : "—";
  if (formula.type === "date") {
    const date = formula.date as { start: string } | null;
    return date ? new Date(date.start).toLocaleDateString("vi-VN") : "";
  }
  return "";
}

function rollupText(rollup: { type: string; [key: string]: unknown }): string {
  if (rollup.type === "number") return rollup.number === null ? "" : String(rollup.number);
  if (rollup.type === "date") {
    const date = rollup.date as { start: string } | null;
    return date ? new Date(date.start).toLocaleDateString("vi-VN") : "";
  }
  if (rollup.type === "array") {
    const items = rollup.array as unknown[];
    return items.length ? `${items.length} giá trị` : "";
  }
  return "";
}
