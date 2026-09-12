import type { GalleryConfig } from "@/lib/notion-cover";
import { parseGalleryConfig } from "@/lib/notion-cover";
import { parseGalleryQuery, type GalleryQuery } from "@/lib/gallery-query";

/** The small, card-facing subset of the legacy gallery configuration that a View owns. */
const VIEW_LAYOUT_KEYS = ["coverAspect", "coverRatio", "coverSource", "cardsPerRow", "card"] as const;

export type GalleryViewRecord = {
  id: string;
  name: string;
  sortOrder: number;
  filterConfig: string;
  sortConfig: string;
  groupBy: string | null;
  layoutConfig: string;
};

/** Reads persisted query JSON with the same resilient parsing used for old URL queries. */
export function parseViewQuery(view: Pick<GalleryViewRecord, "filterConfig" | "sortConfig" | "groupBy">): GalleryQuery {
  return parseGalleryQuery({
    filter: view.filterConfig,
    sort: view.sortConfig,
    group: view.groupBy ?? undefined,
  });
}

/**
 * Keeps old galleries visually stable while a view's JSON is incomplete or came from the
 * first migration, which copies the complete legacy config before later writes narrow it.
 */
export function parseViewLayoutConfig(raw: string, legacy: GalleryConfig): GalleryConfig {
  return { ...legacy, ...parseGalleryConfig(raw) };
}

/** Writes only the presentation values a gallery view is allowed to control. */
export function viewLayoutConfig(config: GalleryConfig): string {
  const layout: Partial<GalleryConfig> = {};
  for (const key of VIEW_LAYOUT_KEYS) {
    const value = config[key];
    if (value !== undefined) Object.assign(layout, { [key]: value });
  }
  return JSON.stringify(layout);
}

/** A convenient migration/creation seed, intentionally preserving only view-owned keys. */
export function initialViewLayoutConfig(rawGalleryConfig: string): string {
  return viewLayoutConfig(parseGalleryConfig(rawGalleryConfig));
}
