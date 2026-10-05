import type { PageObjectResponse } from "@notionhq/client";

export type PagePropertyValue = PageObjectResponse["properties"][string];

/**
 * Notion keys a page's properties by *name*, while Hallery stores property *ids* — names
 * change, ids do not. Looking an id up meant scanning every property, once per field per
 * card per sort comparison. This builds the id index once per page object; snapshot pages
 * are shared and immutable, so the index stays valid for as long as the page is alive.
 */
const indexes = new WeakMap<PageObjectResponse, Map<string, PagePropertyValue>>();

function indexOf(page: PageObjectResponse): Map<string, PagePropertyValue> {
  let index = indexes.get(page);
  if (!index) {
    index = new Map(Object.values(page.properties).map((value) => [value.id, value]));
    indexes.set(page, index);
  }
  return index;
}

export function propertyById(page: PageObjectResponse, propertyId: string): PagePropertyValue | undefined {
  return indexOf(page).get(propertyId);
}
