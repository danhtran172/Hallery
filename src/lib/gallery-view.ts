import { db } from "@/lib/db";
import type { GalleryConfig } from "@/lib/notion-cover";
import { parseGalleryConfig } from "@/lib/notion-cover";
import { parseGalleryQuery, type GalleryQuery } from "@/lib/gallery-query";
import { parseViewType, type ViewType } from "@/lib/table-layout";

/** The small, card-facing subset of the legacy gallery configuration that a View owns. */
const VIEW_LAYOUT_KEYS = ["coverAspect", "coverRatio", "coverSource", "cardsPerRow", "card", "viewType", "table"] as const;

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

export const DEFAULT_VIEW_NAME = "Mặc định";

/** The nested `create` that gives a brand-new Gallery its first view. */
export function defaultViewCreate() {
  return { create: { name: DEFAULT_VIEW_NAME, sortOrder: 0 } };
}

/**
 * A Gallery's views, creating the default one when it has none.
 *
 * The views migration gave every Gallery that existed at the time one view, but nothing
 * gave one to Galleries added afterwards — so a freshly picked database opened on a 404.
 * Every reader goes through here, which also repairs any Gallery that slipped through.
 */
export async function ensureGalleryViews<T extends GalleryViewRecord>(
  gallery: { id: string; displayConfig: string; views: T[] },
): Promise<GalleryViewRecord[]> {
  if (gallery.views.length > 0) return gallery.views;
  const view = await db.galleryView.create({
    data: {
      galleryId: gallery.id,
      name: DEFAULT_VIEW_NAME,
      sortOrder: 0,
      layoutConfig: initialViewLayoutConfig(gallery.displayConfig),
    },
  });
  return [view];
}

/** Whether a view shows cards or a table — read from its own layout, never the legacy config. */
export function viewTypeOf(view: Pick<GalleryViewRecord, "layoutConfig"> | null | undefined): ViewType {
  return parseViewType(view ? parseGalleryConfig(view.layoutConfig).viewType : undefined);
}
