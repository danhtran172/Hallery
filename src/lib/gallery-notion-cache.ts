import type { GetDataSourceResponse, QueryDataSourceResponse } from "@notionhq/client";
import { after } from "next/server";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";

/**
 * A fresh snapshot is never blocked on Notion. Once it becomes stale, callers still get
 * the last known-good data while a single refresh runs after the response. The stale
 * window makes a temporary Notion failure a degraded experience, not a blank Gallery.
 */
const FRESH_TTL_MS = 60 * 1000;
const STALE_TTL_MS = 10 * 60 * 1000;

/** Rows per request. Notion allows up to 100; smaller pages trade round trips for lighter responses. */
const PAGE_SIZE = 50;

/**
 * Ceiling on how many pages one crawl will walk. At Notion's ~3 req/s a database large
 * enough to hit this would keep the first visitor waiting well over ten seconds; stopping
 * leaves `has_more` set, which every counter already reads as "there are more than this".
 */
const MAX_PAGES = 50;

/** Notion allows roughly three requests a second, and a cursor walk is the one place we can outrun it. */
const MIN_REQUEST_GAP_MS = 340;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One Notion crawl per Gallery at a time. SQLite remains the durable cache. */
const refreshesInFlight = new Map<string, Promise<GalleryNotionSnapshot>>();

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
 * Reads a Gallery's durable Notion snapshot. A fresh row is returned immediately; a
 * valid stale row is also returned immediately and revalidated in the background. Only
 * an absent or unusable row makes the request wait for Notion.
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
  if (cached) {
    try {
      const snapshot = parseSnapshot(cached.dataSourceJson, cached.queryJson);
      const now = Date.now();
      // Existing rows receive their new policy lazily, so a migration never has to make
      // one expensive Notion crawl per Gallery before the app can start.
      const freshUntil = cached.freshUntil ?? cached.expiresAt;
      const staleUntil = cached.staleUntil ?? new Date(freshUntil.getTime() + STALE_TTL_MS);

      if (freshUntil.getTime() > now) return snapshot;
      if (staleUntil.getTime() > now) {
        after(() => {
          // The previous snapshot stays visible on failure. The refresh stores a concise
          // diagnostic itself, and swallowing here avoids an unhandled background task.
          return refreshGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken }).catch(() => undefined);
        });
        return snapshot;
      }
    } catch {
      // A bad record must never make a Gallery unavailable; replace it on the miss below.
      await db.galleryNotionCache.delete({ where: { galleryId } });
    }
  }

  return refreshGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken });
}

async function refreshGalleryNotionSnapshot({
  galleryId,
  dataSourceId,
  accessToken,
}: {
  galleryId: string;
  dataSourceId: string;
  accessToken: string;
}): Promise<GalleryNotionSnapshot> {
  const existing = refreshesInFlight.get(galleryId);
  if (existing) return existing;

  const refresh = fetchAndStoreGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken });
  refreshesInFlight.set(galleryId, refresh);
  try {
    return await refresh;
  } finally {
    refreshesInFlight.delete(galleryId);
  }
}

async function fetchAndStoreGalleryNotionSnapshot({
  galleryId,
  dataSourceId,
  accessToken,
}: {
  galleryId: string;
  dataSourceId: string;
  accessToken: string;
}): Promise<GalleryNotionSnapshot> {
  const notion = getNotionClient(accessToken);
  try {
    const [dataSourceRes, queryRes] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: dataSourceId }),
      queryAllPages(notion, dataSourceId),
    ]);
    const snapshot = { dataSourceRes, queryRes };
    const now = Date.now();
    const freshUntil = new Date(now + FRESH_TTL_MS);

    await db.galleryNotionCache.upsert({
      where: { galleryId },
      create: {
        galleryId,
        dataSourceJson: JSON.stringify(dataSourceRes),
        queryJson: JSON.stringify(queryRes),
        expiresAt: freshUntil,
        freshUntil,
        staleUntil: new Date(now + STALE_TTL_MS),
        lastFullReconcileAt: new Date(now),
        lastSyncError: null,
      },
      update: {
        dataSourceJson: JSON.stringify(dataSourceRes),
        queryJson: JSON.stringify(queryRes),
        expiresAt: freshUntil,
        freshUntil,
        staleUntil: new Date(now + STALE_TTL_MS),
        lastFullReconcileAt: new Date(now),
        lastSyncError: null,
      },
    });

    return snapshot;
  } catch (error) {
    // Do not persist error objects (they can contain sensitive request details); a concise
    // reason is enough for local diagnostics and is cleared by the next successful sync.
    await db.galleryNotionCache.updateMany({
      where: { galleryId },
      data: { lastSyncError: error instanceof Error ? error.message.slice(0, 500) : "Notion refresh failed" },
    });
    throw error;
  }
}

/**
 * Walks the cursor to the end of the data source, returning one response holding every row.
 *
 * Notion answers 100 rows at a time, and until now a Gallery only ever saw the first page —
 * so anything past the hundredth item was invisible and every count was a lower bound. The
 * merged result keeps the response shape its callers already expect, with `has_more` left
 * true only when MAX_PAGES cut the walk short, which is exactly when a count is still
 * partial.
 */
async function queryAllPages(
  notion: ReturnType<typeof getNotionClient>,
  dataSourceId: string,
): Promise<QueryDataSourceResponse> {
  let response = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: PAGE_SIZE });
  const results = [...response.results];
  let pages = 1;

  while (response.has_more && response.next_cursor && pages < MAX_PAGES) {
    // The walk is serial, so this is the one throttle that matters: without it a fast link
    // fires cursors back to back and trips Notion's rate limit.
    await wait(MIN_REQUEST_GAP_MS);
    response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: PAGE_SIZE,
      start_cursor: response.next_cursor,
    });
    results.push(...response.results);
    pages += 1;
  }

  return { ...response, results, has_more: Boolean(response.has_more), next_cursor: null };
}

/** Clears stale page data after Hallery writes a page back to Notion. */
export function invalidateGalleryNotionCache(galleryId: string) {
  return db.galleryNotionCache.deleteMany({ where: { galleryId } });
}
