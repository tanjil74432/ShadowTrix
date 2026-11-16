# Performance Report

How it was measured: a **scratch** PostgreSQL 17 database (never the development or a real database) was built from the real migrations and filled with synthetic data by `scripts/perf/seed-large.sql`: **50,001 users, 2,000 events, 300,000 registrations, 4,800 teams, 1,600 submissions with scores, 500,000 audit rows**. Query plans come from `EXPLAIN (ANALYZE)` (`scripts/perf/measure.sql`). HTTP timings come from the real production build (`next start`) talking to that database on the same laptop (so they exclude network latency and TLS). The data is evenly spread and synthetic: real data will be skewed, and this is one machine, one run: treat the numbers as evidence that the queries scale, not as a capacity guarantee. The scratch database was dropped afterwards.

## Query results (milliseconds, execution time)

| Page or feature | Query | Time | Plan |
|---|---|---|---|
| Public event list, category + keyword, page 1 | rows / count | 0.6 / 0.4 | index on `(status, category, starts_at)` |
| Organizer participant list, 25 rows of an event with 150 | rows / status groups | 1.4 / 0.2 | index on `(event_id, status)` |
| Participant dashboard (my registrations) | by user | 0.05 | index on `user_id` |
| Admin users, newest 25 | page | 0.14 | **new** index `users(created_at)` |
| Admin users, text search | `LIKE`/`ILIKE '%x%'` over 50k rows | 24 | sequential scan (a contains-search cannot use a normal index) |
| Audit log, newest 50 | page | 0.24 | **new** index `audit_logs(created_at)` |
| Audit log, security view, 30 days | page / count | 0.3 / 10.5 | created_at index |
| Analytics 30 days | registrations per day / distinct participants / new users | 14 / 13 / 0.4 | **new** indexes on `registrations(registered_at)`, `users(created_at)` |
| Analytics 366 days | registrations per day | 130 | sequential scan (the range covers the whole table: an index does not help) |
| Analytics: judging completion (whole platform) | CTE | 18 | small tables |
| Analytics: groupings (events, roles, team registrations) | | 0.6 / 60 / 17 | `count(DISTINCT)` over 50k roles is the slowest at 60 ms |

### What each new index buys (same queries without the indexes)

| Query | Without | With |
|---|---|---|
| Users newest page | 10.5 ms (scan 50k rows) | 0.14 ms |
| Audit newest page | 48 ms (parallel scan 500k rows) | 0.24 ms |
| Audit security view page | 38.6 ms | 0.3 ms |
| Audit security count (30 days) | 42.7 ms | 10.5 ms |
| Registrations per day (30 days) | 27 ms | 14 ms |
| New users (30 days) | 6.6 ms | 0.4 ms |

A fourth index, `audit_logs(action, created_at)`, was added at first and **removed again** (`...drop_unused_audit_action_index`): the planner never used it (prefix filters joined with OR are served by the `created_at` index), and an unused index only slows audit writes. Indexes are justified by measurement or removed.

## HTTP response times (production build, local, median of 6; minimum and maximum in brackets)

| Request | Median | Range |
|---|---|---|
| `GET /api/health` | 8 ms | 6 to 10 |
| `GET /api/v1/events?q=hackathon&category=HACKATHON` | 35 ms | 27 to 336 (first call warms up) |
| `GET /api/v1/events?page=50` | 33 ms | 23 to 41 |
| `GET /events?q=datathon` (server-rendered page) | 136 ms | 93 to 667 |
| `GET /api/v1/admin/users?pageSize=25` | 24 ms | 15 to 80 |
| `GET /api/v1/admin/users?q=perf-4999` | 45 ms | 38 to 60 |
| `GET /api/v1/admin/events` | 34 ms | 26 to 96 |
| `GET /api/v1/admin/audit?view=security&pageSize=50` | 74 ms | 69 to 215 |
| `GET /api/v1/admin/analytics` (30 days) | 92 ms | 88 to 142 |
| `GET /api/v1/admin/analytics` (366 days) | 154 ms | 138 to 200 |
| `GET /admin/analytics` (page) | 126 ms | 107 to 217 |
| `GET /admin/audit` (page) | 101 ms | 73 to 136 |

## Pagination, caching and large data

- Every list is paginated server-side with a hard cap (events 50, admin lists 100, audit 100, participant list 100) and a stable `(sort key, id)` order; invalid sizes return 400.
- Aggregations run in the database (`GROUP BY`, `count(DISTINCT)`), never over rows in the application. The analytics date range is limited to 366 days.
- Offset pagination is used (`skip`/`take`). It is fine to the sizes above; deep pages of the audit log (hundreds of thousands of rows) would cost more, and cursor pagination is the next step if the audit table grows into the millions.
- Caching: static assets are fingerprinted and cacheable; pages that depend on the session or on the clock are intentionally not cached (`no-store`/private). Public event pages are rendered per request (the registration counts and status change with time and capacity). If traffic requires it, a short cache or revalidation for the public list is the first optimization; it was not added because it was not needed and it would complicate capacity accuracy.
- Not covered: write-heavy load, concurrent users beyond the unit and e2e concurrency tests (14 simultaneous registrations for 5 seats, 7 teams for 3 places, 8 simultaneous scorecard saves, 6 simultaneous invitation answers), and Argon2 cost under login floods (each login deliberately costs a 64 MiB hash; rate limits bound it).

## Bundle and assets (`node ../scripts/perf/bundle-report.mjs` after `npm run build`)

- Client JavaScript and CSS for **all routes together**: 34 files, 868 KB raw, **279 KB gzip** (JS 271 KB, CSS 8 KB). The largest chunk is 70 KB gzip (the React runtime). Per-page JavaScript is a subset of this.
- Fonts: two Geist variable fonts, 70 and 68 KB (woff2), self-hosted (no external requests, which the CSP forbids).
- Images: the logo derivatives are PNG (icon-192 19 KB, icon-512 109 KB, logo mark 246 KB). Event and photo images use `next/image` where displayed. The 246 KB logo mark is the largest asset and could be served as a smaller WebP/AVIF derivative; this was not changed because the logo files are protected and the visual design is frozen.
- No bundle analyzer tool was added; the report above is computed from the build output.

## Limits of this evidence

One machine, synthetic evenly-spread data, loopback networking, a single run per measurement, no concurrent load test and no real-device performance (Lighthouse or Core Web Vitals on real phones and networks were **not** measured). A hosted environment will differ.
