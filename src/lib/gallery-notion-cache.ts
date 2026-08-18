import type { GetDataSourceResponse, QueryDataSourceResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";

/**
 * Gallery requests fan out to two comparatively slow Notion endpoints. A one-minute
 * snapshot is short enough for edits made directly in Notion, while turning repeat
 * visits into local SQLite reads. Hallery edits clear it immediately below.
 */
const CACHE_TTL_MS = 60 * 1000;

export type GalleryNotionSnapshot = {
  dataSourceRes: GetDataSourceResponse;
  queryRes: QueryDataSourceResponse;
};

function parseSnapshot(dataSourceJson: string, queryJson: string): GalleryNotionSnapshot {
  return {
    dataSourceRes: JSON.parse(dataSourceJson) as GetDataSourceResponse,
    queryRes: JSON.parse(queryJson) as QueryDataSourceResponse,
  };
}

/**
 * Reads a Gallery's short-lived Notion snapshot, fetching and storing a new one only
 * when absent or expired. The workspace token is used only for the cache miss and is
 * never persisted in the cache.
 */
export async function getGalleryNotionSnapshot({
  galleryId,
  dataSourceId,
  accessToken,
}: {
  galleryId: string;
  dataSourceId: string;
  accessToken: string;
}): Promise<GalleryNotionSnapshot> {
  const cached = await db.galleryNotionCache.findUnique({ where: { galleryId } });
  if (cached && cached.expiresAt > new Date()) {
    try {
      return parseSnapshot(cached.dataSourceJson, cached.queryJson);
    } catch {
      // A bad record must never make a Gallery unavailable; replace it on the miss below.
      await db.galleryNotionCache.delete({ where: { galleryId } });
    }
  }

  const notion = getNotionClient(accessToken);
  const [dataSourceRes, queryRes] = await Promise.all([
    notion.dataSources.retrieve({ data_source_id: dataSourceId }),
    notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100 }),
  ]);
  const snapshot = { dataSourceRes, queryRes };

  await db.galleryNotionCache.upsert({
    where: { galleryId },
    create: {
      galleryId,
      dataSourceJson: JSON.stringify(dataSourceRes),
      queryJson: JSON.stringify(queryRes),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
    update: {
      dataSourceJson: JSON.stringify(dataSourceRes),
      queryJson: JSON.stringify(queryRes),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
  });

  return snapshot;
}

/** Clears stale page data after Hallery writes a page back to Notion. */
export function invalidateGalleryNotionCache(galleryId: string) {
  return db.galleryNotionCache.deleteMany({ where: { galleryId } });
}
