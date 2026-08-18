import type { Client, DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";
import type { CardLayout } from "@/lib/card-layout";

/** Where a card's cover image comes from. Anything but `content_image` is free — it rides along
 *  with the page data the Gallery already fetches. */
export const PAGE_COVER = "page_cover";
export const CONTENT_IMAGE = "content_image";
/** A Files or URL property, encoded as `property:<name>`. */
export const PROPERTY_PREFIX = "property:";
export const MIN_CARDS_PER_ROW = 1;
export const MAX_CARDS_PER_ROW = 6;
export const DEFAULT_CARDS_PER_ROW = 4;

export type CoverAspect = "landscape" | "portrait" | "square" | "none";

/** Gallery-level display settings, stored as JSON in Gallery.displayConfig. */
export type GalleryConfig = {
  /** Card cover orientation. "none" hides the cover entirely. */
  coverAspect?: CoverAspect;
  /** Ratio within that orientation, e.g. "16:9". Falls back to the orientation's first. */
  coverRatio?: string;
  /** PAGE_COVER | CONTENT_IMAGE | `property:<name>` */
  coverSource?: string;
  /** Number of cards shown across the gallery on desktop. */
  cardsPerRow?: number;
  /** Which properties a card shows and in what order — see lib/card-layout. */
  card?: CardLayout;
};

export function parseGalleryConfig(raw: string): GalleryConfig {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** A safe desktop column count for the gallery grid. */
export function resolveCardsPerRow(config: GalleryConfig): number {
  const value = config.cardsPerRow;
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_CARDS_PER_ROW && value <= MAX_CARDS_PER_ROW
    ? value
    : DEFAULT_CARDS_PER_ROW;
}

/** Ratios offered per orientation; the first of each is that orientation's default. */
export const COVER_RATIOS: Record<Exclude<CoverAspect, "none">, string[]> = {
  landscape: ["16:9", "3:2", "4:3", "2:1", "21:9"],
  portrait: ["2:3", "3:4", "4:5", "9:16", "1:2"],
  square: ["1:1"],
};

/**
 * CSS `aspect-ratio` for a gallery's cards, or null when covers are off.
 * Written as an inline style rather than a Tailwind class so any ratio works
 * without needing a matching class to exist at build time.
 */
export function resolveCoverRatio(config: GalleryConfig): string | null {
  const aspect = config.coverAspect ?? "landscape";
  if (aspect === "none") return null;

  const allowed = COVER_RATIOS[aspect];
  const ratio = config.coverRatio && allowed.includes(config.coverRatio) ? config.coverRatio : allowed[0];
  return ratio.replace(":", " / ");
}

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
