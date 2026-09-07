import {
  isFullPage,
  type GetDataSourceResponse,
  type PageObjectResponse,
  type QueryDataSourceParameters,
  type QueryDataSourceResponse,
} from "@notionhq/client";
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
const FULL_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const DELTA_OVERLAP_MS = 5 * 1000;
const FAILED_SYNC_BACKOFF_MS = 60 * 1000;

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
const deltaSyncsInFlight = new Map<string, Promise<GallerySyncResult>>();

export type GalleryNotionSnapshot = {
  dataSourceRes: GetDataSourceResponse;
  queryRes: QueryDataSourceResponse;
};

export type GallerySyncResult = { changed: boolean; reconciled: boolean };

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
        const retryAfter = cached.lastSyncError ? cached.updatedAt.getTime() + FAILED_SYNC_BACKOFF_MS : 0;
        if (retryAfter <= now) after(() => {
          // The previous snapshot stays visible on failure. The refresh stores a concise
          // diagnostic itself, and swallowing here avoids an unhandled background task.
          return syncGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken }).catch(() => undefined);
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
        lastDeltaSyncAt: new Date(now),
        lastFullReconcileAt: new Date(now),
        lastSyncError: null,
      },
      update: {
        dataSourceJson: JSON.stringify(dataSourceRes),
        queryJson: JSON.stringify(queryRes),
        expiresAt: freshUntil,
        freshUntil,
        staleUntil: new Date(now + STALE_TTL_MS),
        lastDeltaSyncAt: new Date(now),
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
  options?: Pick<QueryDataSourceParameters, "filter">,
): Promise<QueryDataSourceResponse> {
  let response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: PAGE_SIZE,
    ...(options?.filter ? { filter: options.filter } : {}),
  });
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
      ...(options?.filter ? { filter: options.filter } : {}),
    });
    results.push(...response.results);
    pages += 1;
  }

  return { ...response, results, has_more: Boolean(response.has_more), next_cursor: null };
}

/**
 * Merges changes made directly in Notion without blocking the reader's response. Deletions
 * and schema changes still need a bounded full reconcile because Notion's timestamp query
 * cannot enumerate records that no longer belong to the data source.
 */
export async function syncGalleryNotionSnapshot({
  galleryId,
  dataSourceId,
  accessToken,
}: {
  galleryId: string;
  dataSourceId: string;
  accessToken: string;
}): Promise<GallerySyncResult> {
  const pending = deltaSyncsInFlight.get(galleryId);
  if (pending) return pending;

  const sync = syncGalleryNotionSnapshotOnce({ galleryId, dataSourceId, accessToken });
  deltaSyncsInFlight.set(galleryId, sync);
  try {
    return await sync;
  } finally {
    deltaSyncsInFlight.delete(galleryId);
  }
}

async function syncGalleryNotionSnapshotOnce({
  galleryId,
  dataSourceId,
  accessToken,
}: {
  galleryId: string;
  dataSourceId: string;
  accessToken: string;
}): Promise<GallerySyncResult> {
  const fullRefresh = refreshesInFlight.get(galleryId);
  if (fullRefresh) {
    await fullRefresh;
    return { changed: true, reconciled: true };
  }

  const cached = await db.galleryNotionCache.findUnique({ where: { galleryId } });
  const now = Date.now();
  if (!cached || !cached.lastFullReconcileAt || now - cached.lastFullReconcileAt.getTime() >= FULL_RECONCILE_INTERVAL_MS) {
    await refreshGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken });
    return { changed: true, reconciled: true };
  }
  if (cached.lastSyncError && now - cached.updatedAt.getTime() < FAILED_SYNC_BACKOFF_MS) {
    return { changed: false, reconciled: false };
  }

  const watermark = cached.lastDeltaSyncAt ?? cached.lastFullReconcileAt;
  const since = new Date(Math.max(0, watermark.getTime() - DELTA_OVERLAP_MS)).toISOString();
  try {
    const notion = getNotionClient(accessToken);
    const delta = await queryAllPages(notion, dataSourceId, {
      filter: {
        timestamp: "last_edited_time",
        last_edited_time: { after: since },
      },
    });
    return mergeDeltaIntoSnapshot(galleryId, delta.results.filter(isFullPage), new Date(now));
  } catch (error) {
    await recordSyncError(galleryId, error);
    throw error;
  }
}

async function mergeDeltaIntoSnapshot(
  galleryId: string,
  deltaPages: PageObjectResponse[],
  syncedAt: Date,
): Promise<GallerySyncResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cached = await db.galleryNotionCache.findUnique({ where: { galleryId } });
    if (!cached) return { changed: false, reconciled: false };

    let snapshot: GalleryNotionSnapshot;
    try {
      snapshot = parseSnapshot(cached.dataSourceJson, cached.queryJson);
    } catch {
      await db.galleryNotionCache.deleteMany({ where: { galleryId } });
      return { changed: false, reconciled: false };
    }

    const results = [...snapshot.queryRes.results];
    let changed = false;
    for (const page of deltaPages) {
      const index = results.findIndex((result) => result.id === page.id);
      const existing = index >= 0 ? results[index] : null;
      const existingEditedAt =
        existing && "last_edited_time" in existing && typeof existing.last_edited_time === "string"
          ? Date.parse(existing.last_edited_time)
          : Number.NEGATIVE_INFINITY;
      const incomingEditedAt = Date.parse(page.last_edited_time);
      if (existingEditedAt >= incomingEditedAt) continue;
      if (index >= 0) results[index] = page;
      else results.push(page);
      changed = true;
    }

    const updated = await db.galleryNotionCache.updateMany({
      where: { galleryId, updatedAt: cached.updatedAt },
      data: {
        ...(changed ? { queryJson: JSON.stringify({ ...snapshot.queryRes, results }) } : {}),
        freshUntil: new Date(syncedAt.getTime() + FRESH_TTL_MS),
        staleUntil: new Date(syncedAt.getTime() + STALE_TTL_MS),
        lastDeltaSyncAt: syncedAt,
        lastSyncError: null,
      },
    });
    if (updated.count === 1) return { changed, reconciled: false };
  }
  return { changed: false, reconciled: false };
}

async function recordSyncError(galleryId: string, error: unknown) {
  await db.galleryNotionCache.updateMany({
    where: { galleryId },
    data: { lastSyncError: error instanceof Error ? error.message.slice(0, 500) : "Notion sync failed" },
  });
}

/**
 * Applies Hallery's own successful page write to an existing snapshot. This preserves
 * read-your-own-write without replacing schema or unrelated pages with a new full crawl.
 */
export async function patchGalleryNotionSnapshot(galleryId: string, page: PageObjectResponse): Promise<void> {
  // A concurrent background refresh may replace the row between the read and write. The
  // timestamp guard prevents an older in-memory copy from discarding that broader refresh.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cached = await db.galleryNotionCache.findUnique({ where: { galleryId } });
    if (!cached) return;

    let snapshot: GalleryNotionSnapshot;
    try {
      snapshot = parseSnapshot(cached.dataSourceJson, cached.queryJson);
    } catch {
      await db.galleryNotionCache.deleteMany({ where: { galleryId } });
      return;
    }

    const index = snapshot.queryRes.results.findIndex((result) => result.id === page.id);
    const existing = index >= 0 ? snapshot.queryRes.results[index] : null;
    const existingEditedAt =
      existing && "last_edited_time" in existing && typeof existing.last_edited_time === "string"
        ? Date.parse(existing.last_edited_time)
        : Number.NEGATIVE_INFINITY;
    if (existingEditedAt > Date.parse(page.last_edited_time)) return;

    const results = [...snapshot.queryRes.results];
    if (index >= 0) results[index] = page;
    else results.push(page);

    const updated = await db.galleryNotionCache.updateMany({
      where: { galleryId, updatedAt: cached.updatedAt },
      data: { queryJson: JSON.stringify({ ...snapshot.queryRes, results }), lastSyncError: null },
    });
    if (updated.count === 1) return;
  }
}
