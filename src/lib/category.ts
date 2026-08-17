import type { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";

/** Property types that can act as a category axis. */
export const SELECT_AXIS_TYPES = ["select", "multi_select", "status"] as const;
export const AXIS_TYPES = [...SELECT_AXIS_TYPES, "relation"] as const;

export type CategoryAxisRecord = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  sourceType: string;
  displayLabel: string | null;
};

export type CategoryBucket = {
  /** Value used in the URL and in Notion filters. */
  value: string;
  label: string;
  count: number;
};

/** Sentinel for items that have no value on the active axis. */
export const UNCATEGORIZED = "__none__";

export function listAxisCandidates(
  dataSource: DataSourceObjectResponse,
): { id: string; name: string; type: string }[] {
  return Object.entries(dataSource.properties)
    .filter(([, config]) => (AXIS_TYPES as readonly string[]).includes(config.type))
    .map(([name, config]) => ({ id: config.id, name, type: config.type }));
}

/** Every value a page carries on one axis. Multi-select yields several; empty yields none. */
export function valuesOnAxis(page: PageObjectResponse, notionPropertyId: string): string[] {
  const property = Object.values(page.properties).find((p) => p.id === notionPropertyId);
  if (!property) return [];

  if (property.type === "select") return property.select ? [property.select.name] : [];
  if (property.type === "status") return property.status ? [property.status.name] : [];
  if (property.type === "multi_select") return property.multi_select.map((option) => option.name);
  if (property.type === "relation") return property.relation.map((item) => item.id);
  return [];
}

/**
 * Buckets the loaded pages by their values on one axis.
 *
 * Counts describe the pages actually loaded, not the whole database — the caller passes
 * `partial` when more pages remain so the UI can show "7+" instead of an outright wrong 7.
 */
export function bucketPages(
  pages: PageObjectResponse[],
  axis: CategoryAxisRecord,
  labelFor?: (value: string) => string,
): CategoryBucket[] {
  const counts = new Map<string, number>();
  let uncategorized = 0;

  for (const page of pages) {
    const values = valuesOnAxis(page, axis.notionPropertyId);
    if (values.length === 0) {
      uncategorized += 1;
      continue;
    }
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const buckets: CategoryBucket[] = [...counts.entries()]
    .map(([value, count]) => ({ value, label: labelFor?.(value) ?? value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));

  if (uncategorized > 0) {
    buckets.push({ value: UNCATEGORIZED, label: "Chưa phân loại", count: uncategorized });
  }

  return buckets;
}

/** Keeps only the pages matching a chosen category. */
export function filterPagesByCategory(
  pages: PageObjectResponse[],
  axis: CategoryAxisRecord,
  value: string,
): PageObjectResponse[] {
  return pages.filter((page) => {
    const values = valuesOnAxis(page, axis.notionPropertyId);
    return value === UNCATEGORIZED ? values.length === 0 : values.includes(value);
  });
}

/** True when one item can sit in several categories at once, so totals may exceed the item count. */
export function axisAllowsMultiple(sourceType: string): boolean {
  return sourceType === "multi_select" || sourceType === "relation";
}
