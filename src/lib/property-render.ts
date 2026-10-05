import type { NativeButtonConfig } from "@/lib/native-button";

/**
 * What a property renderer needs beyond the value itself. Built on the server, and kept to
 * plain data so it can cross into the client-rendered Card Detail.
 */

/** A page a relation points at, resolved as far as Hallery can see it. */
export type RelationLink = {
  /** Null when the linked table is not shared with the integration, so its titles are unknown. */
  title: string | null;
  /** A Hallery item when its table is a Gallery here, otherwise the page in Notion. */
  href: string;
  internal: boolean;
};

export type RenderContext = {
  galleryId: string;
  pageId: string;
  /** Where the value sits: cards are compact and one tap opens the item; the detail has room. */
  surface: "card" | "detail";
  /** Linked pages by id, for relation properties on this page. */
  relations?: Record<string, RelationLink>;
  /** Native button configs by Notion property id. */
  buttons?: Record<string, NativeButtonConfig>;
};

/** Hallery's item route for a page, which the gallery opens as a popup. */
export function itemHref(galleryId: string, pageId: string): string {
  return `/galleries/${galleryId}/items/${pageId}`;
}
