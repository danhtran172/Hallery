import type { GetDataSourceResponse, QueryDataSourceResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";

/**
 * Gallery requests fan out to two comparatively slow Notion endpoints. A one-minute
 * snapshot is short enough for edits made directly in Notion, while turning repeat
 * visits into local SQLite reads. Hallery edits clear it immediately below.
 */
const CACHE_TTL_MS = 60 * 1000;

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
    queryAllPages(notion, dataSourceId),
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
