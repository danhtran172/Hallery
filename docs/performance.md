# Performance verification log

This log keeps measured optimization results beside the implementation so an
unhelpful idea is not accidentally reintroduced later. Measurements use the
production build against the local 94-item `Game Station` Gallery unless noted.

| Date | Change | Baseline | Result | Verdict |
| --- | --- | --- | --- | --- |
| 2026-09-07 | Persisted Gallery snapshot (pre-existing) | Gallery cache miss: 3.25 s TTFB | Warm Gallery: 0.08 s TTFB | Kept |
| 2026-09-07 | Fresh/stale snapshot windows with in-flight refresh deduplication | Expired snapshot: 2.70 s TTFB in this run | Forced stale snapshot: 0.063 s TTFB; post-refresh: 0.076 s | Kept |

The cold Notion crawl remains dependent on the remote API and is intentionally
not compared to warm/stale requests. Each future slice must add its own
same-condition measurement here.
