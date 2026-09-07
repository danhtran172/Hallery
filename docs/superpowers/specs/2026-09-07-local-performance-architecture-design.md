# Hallery local performance architecture

**Date:** 2026-09-07  
**Status:** Proposed for implementation

## Goal

Keep every normal Hallery interaction local and fast while preserving Notion as
the source of truth. A Gallery with a warm snapshot must not block on Notion;
an Item, the card settings, and category settings must reuse the same local
data. Direct edits in Notion should normally be observed within one minute
while Hallery is open.

This design deliberately targets a single local Next.js process for the next
three months. It adds no Redis, Cloudflare Worker, public tunnel, or remote
copy of workspace tokens.

## Evidence and targets

The production build was measured with a 94-item Gallery on 2026-09-07:

| Flow | Current result |
| --- | --- |
| Gallery cache miss | 3.25 s TTFB, 634 KB response |
| Gallery cache hit | 0.08 s TTFB |
| Item after the snapshot expired | 1.87 s TTFB |
| Settings: Card / Category | 0.41 s / 0.52 s |
| Browser initial Gallery work | 24 item-detail prefetches and 20 cover metadata calls |

Acceptance budgets:

- warm Gallery, Item, and Settings: p95 under 200 ms locally;
- no Notion request on a warm Item or Settings page;
- no automatic Card Detail prefetch for every visible card;
- a Notion change is merged within 60 seconds while Hallery has an active
  visible Gallery tab;
- Hallery create/edit appears immediately without a cache-miss crawl;
- cache failure never leaves a page blank when a valid stale snapshot exists.

## Invariants

1. Notion remains the source of truth for page values and schema. Hallery does
   not mutate Notion schema.
2. Workspace tokens, the data snapshot, original covers, and generated image
   derivatives remain local.
3. Hallery writes are read-your-own-write: a successful Notion mutation patches
   the local snapshot before the response is rendered.
4. One Gallery cache refresh can run at a time in the local process. All
   readers join it or receive the last valid snapshot.
5. Cache entries are versioned and bounded. A cache is disposable; user data is
   not.

## Components

### 1. Gallery snapshot store

`GalleryNotionCache` remains the durable local snapshot for the first
implementation. It gains explicit freshness and sync metadata rather than
using one opaque expiry:

- `freshUntil`: returns immediately with no sync;
- `staleUntil`: returns immediately and schedules one background refresh;
- `lastDeltaSyncAt`: watermark for changed pages;
- `lastFullReconcileAt`: last complete crawl;
- `lastSyncError`: diagnostic text only, never user secrets.

The existing raw Notion payload remains compatible with current renderers. It
is acceptable at the measured 343 KB for 94 pages. If profiling shows the
serialized snapshot is a bottleneck at larger data sources, the next migration
splits pages into page-level snapshot rows. That is intentionally deferred:
doing it now would add consistency complexity before the measured need exists.

Each caller goes through `getGalleryNotionSnapshot`. The API is:

```
fresh snapshot          -> return it
valid stale snapshot    -> return it; schedule refresh once
no valid snapshot       -> await one full refresh
refresh already running -> join it if there is no usable snapshot
```

A module-local in-flight promise map is only a request-deduplication aid. The
SQLite row is the durable source after restart.

### 2. Local delta synchronizer

The synchronizer runs only while Hallery is actively used. A small client
heartbeat is mounted for a visible Gallery and calls an authenticated same-origin
route at most once per minute. The route asks Notion for pages whose
`last_edited_time` is newer than the persisted watermark, with a small overlap
to tolerate clock and delivery boundaries, then merges those full page records
into the snapshot.

The heartbeat does not run in a hidden tab, does not refresh during a form
submission, and does not reset gallery scroll state. It reports changes for a
non-disruptive UI refresh on the next navigation. A manual refresh action may
request an immediate high-priority sync.

A full pagination crawl and schema retrieval occurs on the existing cold path
and at most every ten minutes for an active Gallery. That reconciliation
removes pages that were deleted or moved and notices schema changes, which a
timestamp delta alone cannot safely infer.

The synchronizer has one per-Gallery lock and respects the existing Notion
request gap. A failed sync retains the stale snapshot, stores a non-secret
error reason, and backs off rather than retrying in a tight loop.

### 3. Write-through mutation path

Create and edit server actions receive the updated page response from Notion.
They patch or append that page in the serialized snapshot in one SQLite write.
They invalidate only affected cover records when the page cover, image property,
or content image can have changed. They must not delete the whole snapshot.

If a background delta and a mutation overlap, the record with the newer
Notion `last_edited_time` wins. A mutation response is therefore visible
immediately, while a delayed older delta cannot revert it.

### 4. Read-model and navigation boundary

Gallery, Item Detail, Card Settings, and Category Settings read the same
snapshot. Card Settings uses the snapshot schema and first page as its preview;
Category Settings uses the snapshot schema. They make an external Notion call
only on an initial empty cache.

Card Detail links opt out of viewport prefetch. The route is already fast from
the snapshot, so prefetching every card consumes CPU and route requests without
an interaction benefit.

The Gallery will expose a server-produced page of cards, initially 24. Search,
filter, sort, grouping, and category selection continue to evaluate against the
complete local snapshot; only card data needed for the current page is sent to
the browser. A "Xem thêm" action preserves query state and fetches the next
page. It resets to the first page on a query change.

This feed change is implemented after the cache slice and measured separately.
It is not permitted to change card dimensions, layout semantics, or query
results.

### 5. Cover Cache v2

The cover cache becomes a bounded local derivative cache:

| Variant | Use |
| --- | --- |
| 64 px WebP | blurred immediate placeholder |
| 320 px WebP | Gallery card image |
| 768 px WebP | Card Detail image |

Each derivative key includes the Notion page id, source fingerprint, target
size, and encoder version. A changed cover gets a new key. Original bytes are
only retained when needed to derive variants or display the detail; cards do
not load a multi-megabyte original by default.

A shared priority queue admits a small fixed number of remote fetch and Sharp
jobs. Visible cards are high priority, near-viewport cards are buffer priority,
and duplicate jobs share the same promise. Work whose only consumers leave the
viewport is cancelled before it starts. The server sends a batch cover manifest
for cached visible cards to avoid one metadata request per card.

Files are written to a temporary filename then atomically renamed. A 512 MB
local byte budget is pruned approximately by least-recently-used access outside
the interactive path. Browser responses for immutable variants keep long-lived
HTTP cache headers.

### 6. Observability and safety

The application records bounded, non-secret samples for snapshot cache hit/miss,
refresh duration, delta count, thumbnail queue time, thumbnail generation time,
and Gallery response size. It exposes no Notion token, signed image URL, or
page property value in logs.

Each implementation slice includes a reproducible production-server timing
check for dashboard, cold/warm Gallery, Item, Card Settings, and Category
Settings. Browser-network verification confirms that card-detail prefetches and
per-card cover metadata requests decrease as intended.

## Delivery sequence

1. **Cache core:** migration, stale-while-revalidate state, in-flight
   deduplication, cache diagnostics, and regression tests.
2. **Read/write integration:** Settings and Item consume the common snapshot;
   create/edit patch it; card-detail prefetch is disabled. Measure and commit.
3. **Delta heartbeat:** sync route, visible-tab heartbeat, timestamp merge,
   reconciliation, locking, and backoff. Measure and commit.
4. **Feed delivery:** page cards at 24 items, preserved query state, and
   response-size measurement. Measure and commit.
5. **Cover Cache v2:** variants, manifest, queue, atomic writes, and budgeted
   pruning. Measure and commit.

Every slice must leave lint and production build green. A change that fails to
beat its matching baseline is removed rather than retained as complexity.

## Deferred or intentionally excluded

- Cloudflare Worker, D1, R2, public tunnel, and remote token storage;
- Notion webhooks;
- page-level snapshot tables before the current JSON snapshot proves too large;
- Canvas/ImageBitmap cache copied from Mosaic; browser HTTP caching and bounded
  card pages are lower-risk for this web app;
- schema mutation in Notion.
