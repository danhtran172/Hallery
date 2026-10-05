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
import { NotionAccessError, classifyNotionError, type NotionProblem } from "@/lib/notion-errors";

/**
 * A fresh snapshot is never blocked on Notion. Once it becomes stale, callers still get
 * the last known-good data while a single refresh runs after the response, and the
 * visible Gallery's heartbeat refreshes the screen once that lands. Only a snapshot older
 * than the stale window makes a reader wait — and even then a failed refresh falls back
 * to the old copy, so a Notion outage degrades the Gallery instead of blanking it.
 */
const FRESH_TTL_MS = 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
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
  /** Every full page in the snapshot, in Notion's order. */
  pages: PageObjectResponse[];
  /** The same pages by id, so a single item never needs a scan. */
  pageById: Map<string, PageObjectResponse>;
  /**
   * Set when the latest attempt to refresh from Notion failed. The data is still the last
   * good copy; the reader just deserves to know it may be behind, and why.
   */
  syncProblem: NotionProblem | null;
};

export type GallerySyncResult = { changed: boolean; reconciled: boolean };

const NOTION_PROBLEMS = new Set<NotionProblem>(["unauthorized", "not_shared", "rate_limited", "unavailable"]);

/** The stored sync error starts with its classification, e.g. `not_shared: Could not find…`. */
function problemFromStoredError(stored: string | null): NotionProblem | null {
  if (!stored) return null;
  const head = stored.split(":", 1)[0] as NotionProblem;
  return NOTION_PROBLEMS.has(head) ? head : "unavailable";
}

function storedSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Notion refresh failed";
  return `${classifyNotionError(error)}: ${message}`.slice(0, 500);
}

function buildSnapshot(
  dataSourceRes: GetDataSourceResponse,
  queryRes: QueryDataSourceResponse,
  syncProblem: NotionProblem | null,
): GalleryNotionSnapshot {
  const pages = queryRes.results.filter(isFullPage);
  return { dataSourceRes, queryRes, pages, pageById: new Map(pages.map((page) => [page.id, page])), syncProblem };
}

function parseSnapshot(dataSourceJson: string, queryJson: string): Pick<GalleryNotionSnapshot, "dataSourceRes" | "queryRes"> {
  return {
    dataSourceRes: JSON.parse(dataSourceJson) as GetDataSourceResponse,
    queryRes: JSON.parse(queryJson) as QueryDataSourceResponse,
  };
}

/**
 * Parsed snapshots, keyed by Gallery and versioned by the row's `updatedAt`.
 *
 * The stored JSON for a few hundred pages runs to megabytes, and every Gallery render, item
 * popup and cover request used to read and parse all of it again. A row only changes when a
 * sync or a write lands, so the parsed copy is reused until then. Readers must treat it as
 * immutable — it is shared between requests.
 */
const MAX_PARSED_SNAPSHOTS = 16;
const parsedSnapshots = new Map<string, { version: number; snapshot: GalleryNotionSnapshot }>();

function rememberParsed(galleryId: string, version: number, snapshot: GalleryNotionSnapshot) {
  parsedSnapshots.delete(galleryId);
  parsedSnapshots.set(galleryId, { version, snapshot });
  while (parsedSnapshots.size > MAX_PARSED_SNAPSHOTS) {
    const oldest = parsedSnapshots.keys().next().value;
    if (oldest === undefined) break;
    parsedSnapshots.delete(oldest);
  }
}

/** The parsed snapshot for a row version, reading the JSON only when that version is new. */
async function loadParsedSnapshot(
  galleryId: string,
  version: number,
  syncProblem: NotionProblem | null,
): Promise<GalleryNotionSnapshot | null> {
  const memo = parsedSnapshots.get(galleryId);
  if (memo && memo.version === version) return memo.snapshot;

  const row = await db.galleryNotionCache.findUnique({
    where: { galleryId },
    select: { dataSourceJson: true, queryJson: true, updatedAt: true },
  });
  if (!row) return null;
  try {
    const parsed = parseSnapshot(row.dataSourceJson, row.queryJson);
    const snapshot = buildSnapshot(parsed.dataSourceRes, parsed.queryRes, syncProblem);
    rememberParsed(galleryId, row.updatedAt.getTime(), snapshot);
    return snapshot;
  } catch {
    // A bad record must never make a Gallery unavailable; it is replaced by the next crawl.
    await db.galleryNotionCache.deleteMany({ where: { galleryId } });
    parsedSnapshots.delete(galleryId);
    return null;
  }
}

/**
 * Reads a Gallery's durable Notion snapshot. A fresh row is returned immediately; a stale
 * row is also returned immediately and revalidated in the background. Only an absent row,
 * or one past the stale window, makes the request wait for Notion — and a failure there
 * still returns the old copy when one exists. Throws `NotionAccessError` only when there is
 * nothing at all to show.
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
  const meta = await db.galleryNotionCache.findUnique({
    where: { galleryId },
    select: { updatedAt: true, freshUntil: true, staleUntil: true, expiresAt: true, lastSyncError: true },
  });

  if (meta) {
    const syncProblem = problemFromStoredError(meta.lastSyncError);
    const snapshot = await loadParsedSnapshot(galleryId, meta.updatedAt.getTime(), syncProblem);
    if (snapshot) {
      const now = Date.now();
      // Existing rows receive their new policy lazily, so a migration never has to make
      // one expensive Notion crawl per Gallery before the app can start.
      const freshUntil = meta.freshUntil ?? meta.expiresAt;
      const staleUntil = Math.max(
        meta.staleUntil?.getTime() ?? 0,
        freshUntil.getTime() + STALE_TTL_MS,
      );

      if (freshUntil.getTime() > now) return snapshot;
      if (staleUntil > now) {
        const retryAfter = meta.lastSyncError ? meta.updatedAt.getTime() + FAILED_SYNC_BACKOFF_MS : 0;
        if (retryAfter <= now) after(() => {
          // The previous snapshot stays visible on failure. The refresh stores a concise
          // diagnostic itself, and swallowing here avoids an unhandled background task.
          return syncGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken }).catch(() => undefined);
        });
        return snapshot;
      }

      try {
        return await refreshGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken });
      } catch (error) {
        return { ...snapshot, syncProblem: classifyNotionError(error) };
      }
    }
  }

  try {
    return await refreshGalleryNotionSnapshot({ galleryId, dataSourceId, accessToken });
  } catch (error) {
    throw new NotionAccessError(classifyNotionError(error));
  }
}

/**
 * The stored snapshot as it is, without ever calling Notion — for looking things up in
 * another Gallery (a relation's titles) where waiting on a crawl is not worth it.
 */
export async function peekGalleryNotionSnapshot(galleryId: string): Promise<GalleryNotionSnapshot | null> {
  const meta = await db.galleryNotionCache.findUnique({
    where: { galleryId },
    select: { updatedAt: true, lastSyncError: true },
  });
  if (!meta) return null;
  return loadParsedSnapshot(galleryId, meta.updatedAt.getTime(), problemFromStoredError(meta.lastSyncError));
}

/** The snapshot's page with this id, when the Gallery holds one. */
export function snapshotPage(snapshot: GalleryNotionSnapshot, pageId: string): PageObjectResponse | undefined {
  return snapshot.pageById.get(pageId) ?? snapshot.pageById.get(normalizeNotionId(pageId));
}

/** Notion ids arrive dashed or undashed depending on the source; the API answers in dashed form. */
export function normalizeNotionId(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
    const snapshot = buildSnapshot(dataSourceRes, queryRes, null);
    const now = Date.now();
    const freshUntil = new Date(now + FRESH_TTL_MS);

    const stored = await db.galleryNotionCache.upsert({
      select: { updatedAt: true },
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
    rememberParsed(galleryId, stored.updatedAt.getTime(), snapshot);

    return snapshot;
  } catch (error) {
    // Do not persist error objects (they can contain sensitive request details); a concise
    // reason is enough for local diagnostics and is cleared by the next successful sync.
    await db.galleryNotionCache.updateMany({
      where: { galleryId },
      data: { lastSyncError: storedSyncError(error) },
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

  const cached = await db.galleryNotionCache.findUnique({
    where: { galleryId },
    select: { lastFullReconcileAt: true, lastDeltaSyncAt: true, lastSyncError: true, updatedAt: true },
  });
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

/** Notion's edit stamp of a snapshot row, or -∞ for a partial page that has none. */
function editedAt(result: QueryDataSourceResponse["results"][number] | undefined): number {
  return result && "last_edited_time" in result && typeof result.last_edited_time === "string"
    ? Date.parse(result.last_edited_time)
    : Number.NEGATIVE_INFINITY;
}

/**
 * Applies `edit` to the current snapshot and stores the result, guarded by the row's
 * `updatedAt` so a concurrent full refresh is never overwritten by an older copy. The new
 * parsed snapshot is remembered directly, so the next reader does not parse it again.
 */
async function rewriteSnapshot(
  galleryId: string,
  edit: (snapshot: GalleryNotionSnapshot) => {
    results: QueryDataSourceResponse["results"] | null;
    data?: { freshUntil?: Date; staleUntil?: Date; lastDeltaSyncAt?: Date };
  } | null,
): Promise<{ written: boolean; changed: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const meta = await db.galleryNotionCache.findUnique({ where: { galleryId }, select: { updatedAt: true } });
    if (!meta) return { written: false, changed: false };
    const snapshot = await loadParsedSnapshot(galleryId, meta.updatedAt.getTime(), null);
    if (!snapshot) return { written: false, changed: false };

    const next = edit(snapshot);
    if (!next) return { written: false, changed: false };
    const queryRes = next.results ? { ...snapshot.queryRes, results: next.results } : snapshot.queryRes;

    try {
      const stored = await db.galleryNotionCache.update({
        where: { galleryId, updatedAt: meta.updatedAt },
        data: {
          ...(next.results ? { queryJson: JSON.stringify(queryRes) } : {}),
          ...next.data,
          lastSyncError: null,
        },
        select: { updatedAt: true },
      });
      rememberParsed(galleryId, stored.updatedAt.getTime(), buildSnapshot(snapshot.dataSourceRes, queryRes, null));
      return { written: true, changed: Boolean(next.results) };
    } catch {
      // Another writer got there first; re-read and apply the edit on top of theirs.
    }
  }
  return { written: false, changed: false };
}

async function mergeDeltaIntoSnapshot(
  galleryId: string,
  deltaPages: PageObjectResponse[],
  syncedAt: Date,
): Promise<GallerySyncResult> {
  const { changed } = await rewriteSnapshot(galleryId, (snapshot) => {
    const results = [...snapshot.queryRes.results];
    let dirty = false;
    for (const page of deltaPages) {
      const index = results.findIndex((result) => result.id === page.id);
      if (editedAt(index >= 0 ? results[index] : undefined) >= Date.parse(page.last_edited_time)) continue;
      if (index >= 0) results[index] = page;
      else results.push(page);
      dirty = true;
    }
    return {
      results: dirty ? results : null,
      data: {
        freshUntil: new Date(syncedAt.getTime() + FRESH_TTL_MS),
        staleUntil: new Date(syncedAt.getTime() + STALE_TTL_MS),
        lastDeltaSyncAt: syncedAt,
      },
    };
  });
  return { changed, reconciled: false };
}

async function recordSyncError(galleryId: string, error: unknown) {
  await db.galleryNotionCache.updateMany({
    where: { galleryId },
    data: { lastSyncError: storedSyncError(error) },
  });
}

/**
 * Applies Hallery's own successful page write to an existing snapshot. This preserves
 * read-your-own-write without replacing schema or unrelated pages with a new full crawl.
 */
export async function patchGalleryNotionSnapshot(galleryId: string, page: PageObjectResponse): Promise<void> {
  await rewriteSnapshot(galleryId, (snapshot) => {
    const index = snapshot.queryRes.results.findIndex((result) => result.id === page.id);
    if (editedAt(index >= 0 ? snapshot.queryRes.results[index] : undefined) > Date.parse(page.last_edited_time)) {
      return null;
    }
    const results = [...snapshot.queryRes.results];
    if (index >= 0) results[index] = page;
    else results.push(page);
    return { results };
  });
}

