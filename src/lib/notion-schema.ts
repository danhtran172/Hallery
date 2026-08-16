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
