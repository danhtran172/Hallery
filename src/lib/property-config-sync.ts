import type { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { detectResolvedTypes } from "@/lib/property-kind";

type ExistingPropertyConfig = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  isMissing: boolean;
  sortOrder: number;
};

/**
 * Reconciles Hallery's property inventory from the data-source response the
 * Gallery already fetched. No extra Notion request and no Notion mutation.
 */
export async function syncPropertyConfigs(
  galleryId: string,
  existing: ExistingPropertyConfig[],
  dataSource: DataSourceObjectResponse,
) {
  const live = Object.entries(dataSource.properties).map(([name, property]) => ({
    id: property.id,
    name,
    type: property.type,
  }));
  const liveById = new Map(live.map((property) => [property.id, property]));
  const knownIds = new Set(existing.map((property) => property.notionPropertyId));
  const operations = [];

  for (const property of existing) {
    const current = liveById.get(property.notionPropertyId);
    if (!current && !property.isMissing) {
      operations.push(db.propertyConfig.update({ where: { id: property.id }, data: { isMissing: true } }));
    }
    if (current && (property.isMissing || property.notionPropertyName !== current.name)) {
      operations.push(
        db.propertyConfig.update({
          where: { id: property.id },
          data: { notionPropertyName: current.name, isMissing: false },
        }),
      );
    }
  }

  let nextSortOrder = Math.max(-1, ...existing.map((property) => property.sortOrder)) + 1;
  for (const property of live) {
    if (knownIds.has(property.id)) continue;
    // Upsert, not create: two renders of the same Gallery (a reload during a slow first
    // load) can both see the new property, and the second create hit the unique key and
    // took the whole page down.
    operations.push(
      db.propertyConfig.upsert({
        where: { galleryId_notionPropertyId: { galleryId, notionPropertyId: property.id } },
        update: {},
        create: {
          galleryId,
          notionPropertyId: property.id,
          notionPropertyName: property.name,
          notionPropertyType: property.type,
          sortOrder: nextSortOrder,
        },
      }),
    );
    nextSortOrder += 1;
  }

  if (operations.length) await db.$transaction(operations);
}

/**
 * Records what each formula/rollup property evaluates to, read off a page the caller
 * already fetched — no extra Notion request. Only writes when the answer changed, so a
 * gallery view that hasn't touched its formulas does no database work.
 */
export async function syncResolvedTypes(
  existing: { id: string; notionPropertyId: string; resolvedType: string | null }[],
  samplePage: PageObjectResponse | undefined,
) {
  if (!samplePage) return;

  const detected = detectResolvedTypes(samplePage);
  const operations = [];

  for (const property of existing) {
    const current = detected.get(property.notionPropertyId);
    if (current && current !== property.resolvedType) {
      operations.push(
        db.propertyConfig.update({ where: { id: property.id }, data: { resolvedType: current } }),
      );
    }
  }

  if (operations.length) await db.$transaction(operations);
}
