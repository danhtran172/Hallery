import type { DataSourceObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";

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
    operations.push(
      db.propertyConfig.create({
        data: {
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
