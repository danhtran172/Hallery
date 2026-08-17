import type { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";

type DataSourceProperties = DataSourceObjectResponse["properties"];

export function getTitlePropertyName(properties: DataSourceProperties): string | null {
  for (const [name, config] of Object.entries(properties)) {
    if (config.type === "title") return name;
  }
  return null;
}

export function getPageTitle(page: PageObjectResponse, titlePropertyName: string | null): string {
  if (!titlePropertyName) return "Untitled";
  const prop = page.properties[titlePropertyName];
  if (prop?.type === "title") {
    const text = prop.title.map((t) => t.plain_text).join("");
    return text || "Untitled";
  }
  return "Untitled";
}

export function getPageIcon(page: PageObjectResponse): string | null {
  if (!page.icon) return null;
  if (page.icon.type === "emoji") return page.icon.emoji;
  if (page.icon.type === "external") return page.icon.external.url;
  if (page.icon.type === "file") return page.icon.file.url;
  return null;
}

type PropertyValue = PageObjectResponse["properties"][string];

/** Plain string/boolean form of a property value, for pre-filling an edit input. Empty string if empty. */
export function getEditableValue(value: PropertyValue): string | boolean {
  switch (value.type) {
    case "title":
      return value.title.map((t) => t.plain_text).join("");
    case "rich_text":
      return value.rich_text.map((t) => t.plain_text).join("");
    case "number":
      return value.number === null ? "" : String(value.number);
    case "url":
      return value.url ?? "";
    case "email":
      return value.email ?? "";
    case "phone_number":
      return value.phone_number ?? "";
    case "checkbox":
      return value.checkbox;
    case "date":
      return value.date ? value.date.start.slice(0, 10) : "";
    case "select":
      return value.select?.name ?? "";
    case "status":
      return value.status?.name ?? "";
    case "multi_select":
      return value.multi_select.map((o) => o.name).join(", ");
    default:
      return "";
  }
}
