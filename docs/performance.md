# Performance verification log

This log keeps measured optimization results beside the implementation so an
unhelpful idea is not accidentally reintroduced later. Measurements use the
production build against the local 94-item `Game Station` Gallery unless noted.

| Date | Change | Baseline | Result | Verdict |
| --- | --- | --- | --- | --- |
| 2026-09-07 | Persisted Gallery snapshot (pre-existing) | Gallery cache miss: 3.25 s TTFB | Warm Gallery: 0.08 s TTFB | Kept |
| 2026-09-07 | Fresh/stale snapshot windows with in-flight refresh deduplication | Expired snapshot: 2.70 s TTFB in this run | Forced stale snapshot: 0.063 s TTFB; post-refresh: 0.076 s | Kept |
| 2026-09-07 | Card and Category Settings read the Gallery snapshot | Card/Category: 0.41 s / 0.52 s | Warm Card/Category: 0.040 s / 0.019 s | Kept |
| 2026-09-07 | Disable viewport prefetch on Gallery card links | 24 Item Detail prefetches on first Gallery visit | 0 Item Detail requests in a fresh browser visit | Kept |
| 2026-09-07 | Visible-tab Notion delta heartbeat | No proactive local-cache update | One 36-byte same-origin POST; 0.97 s background delta check | Kept |
| 2026-09-07 | Server-paged Gallery cards (24 per page) | 94-card response: 634 KB | First 24 cards: 184 KB, warm TTFB 0.068 s; 48 cards: 341 KB | Kept |
| 2026-09-07 | Cover queue, atomic file writes and 512 MB LRU bound | Unbounded parallel cover work and direct writes | 34 Gallery images render with no browser errors; queue now limits work to 3 jobs | Kept |

The cold Notion crawl remains dependent on the remote API and is intentionally
not compared to warm/stale requests. Each future slice must add its own
same-condition measurement here.
