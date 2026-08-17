import type { Client, DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";

/** Where a card's cover image comes from. Anything but `content_image` is free — it rides along
 *  with the page data the Gallery already fetches. */
export const PAGE_COVER = "page_cover";
export const CONTENT_IMAGE = "content_image";
/** A Files or URL property, encoded as `property:<name>`. */
export const PROPERTY_PREFIX = "property:";

/** Gallery-level display settings, stored as JSON in Gallery.displayConfig. */
export type GalleryConfig = {
  /** Card cover shape. "none" hides the cover entirely. */
  coverAspect?: "landscape" | "portrait" | "square" | "none";
  /** PAGE_COVER | CONTENT_IMAGE | `property:<name>` */
  coverSource?: string;
};

export function parseGalleryConfig(raw: string): GalleryConfig {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export const COVER_ASPECT_CLASS: Record<string, string> = {
  landscape: "aspect-[16/9]",
  portrait: "aspect-[2/3]",
  square: "aspect-square",
};

/** Property types that can hold something we can show as an image. */
export function listImagePropertyNames(dataSource: DataSourceObjectResponse): string[] {
  return Object.entries(dataSource.properties)
    .filter(([, config]) => config.type === "files" || config.type === "url")
    .map(([name]) => name);
}

/**
 * Cover URL for a page, for every source except `content_image` — which needs a
 * per-page API call and is resolved lazily on the client instead.
 */
export function resolveCoverUrl(page: PageObjectResponse, source: string | undefined): string | null {
  if (source === CONTENT_IMAGE) return null;

  if (source?.startsWith(PROPERTY_PREFIX)) {
    const property = page.properties[source.slice(PROPERTY_PREFIX.length)];
    if (!property) return null;
    if (property.type === "url") return property.url;
    if (property.type === "files") {
      const file = property.files[0];
      if (!file) return null;
      return file.type === "external" ? file.external.url : file.file.url;
    }
    return null;
  }

  if (!page.cover) return null;
  return page.cover.type === "external" ? page.cover.external.url : page.cover.file.url;
}

/** URL of the first image block inside a page. Costs one API call. */
export async function findFirstImageUrl(notion: Client, pageId: string): Promise<string | null> {
  const children = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  for (const block of children.results) {
    if ("type" in block && block.type === "image") {
      return block.image.type === "external" ? block.image.external.url : block.image.file.url;
    }
  }
  return null;
}
