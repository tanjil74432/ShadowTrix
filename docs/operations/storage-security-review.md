# Storage lifecycle security review (direct uploads, cleanup, deletion outbox)

Reviewed 2026-11-16 on the final code. "Proven" means an automated test fails if the property breaks; "live" means checked against the real Backblaze bucket.

## Architecture in one paragraph

A direct upload gets a `pending_uploads` ledger row (PENDING) in the transaction that authorizes it. The browser PUTs to a 15-minute signed URL for a temporary `incoming/` key bound to one key, one content type and one exact length (live: a longer body, another type or another key is refused with 403). `complete` reads the object back, validates it fully, queues a guard job for a new permanent key, writes the validated bytes to that key, and attaches only the permanent key (the temporary key is deleted after its URL has expired). Every way an object can become unreachable now writes a row to the durable `storage_deletions` outbox **in the same transaction**: database triggers for deleted submission files (including cascades), member photos and certificates, and server code for rejected and expired uploads. A worker deletes the object with all its versions outside any transaction and removes the row only afterwards.

## State machine (`pending_uploads.status`)

| From | To | By | Guard |
|---|---|---|---|
| (none) | PENDING | prepare | same transaction as the authorization; CHECK constraints on size, expiry and `resolved_at` |
| PENDING | COMPLETED | complete (inside its transaction) | `WHERE status='PENDING' AND expires_at > now`; commits together with the file row |
| PENDING | REJECTED | complete, content refused or attach failed | `WHERE status='PENDING'`; deletion queued in the same transaction |
| PENDING | EXPIRED | cleanup sweep | `WHERE status='PENDING' AND expires_at < now`; deletion queued in the same transaction |
| EXPIRED | COMPLETED | sweep only, if a file row already uses the key | heals an inconsistent row, never deletes |

Every transition out of PENDING is one conditional UPDATE, so exactly one party wins. Proven by the 12-round completion-versus-cleanup race tests (no attached file without its object, no object without a decision). A resolved row can never return to PENDING (the old "revert on failure" path was removed: failures now live in the outbox).

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **Team disbanding** deleted draft submissions (and by cascade their file rows) without deleting the stored objects. | High (confirmed bug) | **Fixed.** A trigger queues the key when the file row disappears, whatever deleted it. Proven for team disband, leader leaving alone, event deletion, direct submission deletion, multi-version submissions, rollback and race cases. |
| 2 | Other cascade paths (event deletion, administrator tooling, any future delete) had the same gap. | High | **Fixed** by the same trigger. Also covers member photos (delete and replace) and certificate storage keys. |
| 3 | A process crash between "claim the expired row" and "delete the object" left an EXPIRED row whose object was never retried. | Medium | **Fixed.** Claim and queue happen in one transaction; the worker uses a lease and retries. Proven (lease expiry recovery test). |
| 4 | A rejected upload whose deletion failed was swallowed with no retry. | Medium | **Fixed.** The deletion is queued in the rejecting transaction; failures keep the job. Proven. |
| 5 | `remove` listed at most 100 versions. A signed URL reused many times could leave more behind. | Low | **Fixed.** `remove` loops until no version is left (cap 50 rounds, then an error so the job retries). |
| 6 | If the credential may not list versions, `remove` falls back to a plain delete, which on Backblaze only **hides** the file. | Low | **Mitigated.** A warning is logged (no key, no URL). The live self-test proves the current key can list and fully purge versions; keep the key's listFiles capability. |
| 7 | Completion versus cleanup, completion versus deletion, duplicate workers, double-queue, rollback. | n/a | **Proven safe** (see tests below). |
| 8 | A signed upload URL stays valid for up to 15 minutes after completion, so the same user could overwrite their own object after it was validated (same length and type, different bytes) or create extra versions. Backblaze answers 501 to `If-None-Match`, so create-only writes cannot be signed (live probe). | Low to medium | **Fixed (immutable objects).** Temporary uploads live under `incoming/`. After validation the server writes exactly the validated bytes to a NEW key under `submissions/` and attaches only that key; the temporary key is queued for deletion 17 minutes after the signed URL was issued (URL validity plus slack). Proven by 10 tests: re-PUT to the old URL cannot change the attached bytes or their SHA-256, the permanent bytes equal the validated bytes, the delayed deletion, failed-copy retry, guard-before-copy, crash recovery, copy-then-refused-attach, double completion and completion-versus-cleanup races. The real-bucket version of the tamper test is in `e2e/b2-browser-upload.spec.ts` (needs the CORS rule). |
| 9 | Cleanup endpoint accepted a bare secret without the `Bearer` scheme. | Low | **Fixed.** The scheme is required. `GET` (needed by Vercel Cron) uses the same check; unauthenticated GET and POST both return 401. |
| 10 | Direct upload rows have no foreign keys by design (so an object can be reaped after its submission or user is gone). | n/a | Documented. Proven by the "submission deleted while an upload is pending" tests. |
| 11 | Certificate PDFs are generated on the fly; `certificates.storage_key` is unused today. | n/a | A trigger already protects it if it is ever used. |

## Design of the fix for finding 8 (implemented)

After validation, `complete` queues a guard job for a **new** server-generated key (30 minutes), writes the validated bytes (already held in memory) to it, and in the attaching transaction removes the guard, stores the permanent key on the file and queues the upload key with `next_attempt_at = upload time + 17 minutes` (after the URL has expired). Later PUTs to the old URL can only change an object that is deleted anyway, and the attached file can no longer be altered. Cost: one extra server upload of at most 10 MB per file. Tests: overwrite after completion does not change the attached bytes; the upload key is deleted after the delay; failure and retry; no orphan.

## Authorization and scheduling

- The maintenance endpoint is disabled (404) unless `CRON_SECRET` is set, compares in constant time, requires `Authorization: Bearer <secret>` for GET and POST, never returns object keys, and logs counts only. Proven by e2e: no header, wrong secret, almost-right secret, secret without scheme, all 401 and nothing deleted; parallel authorized calls are harmless (lost races are reported as skipped).
- Vercel Cron (Hobby): once a day, anywhere within the hour plus up to 59 minutes (verified on Vercel's page). Orphaned objects are also deleted immediately after each commit, so a day's delay is a safety-net delay only.
- The worker never accepts a key from a client. Before deleting it re-checks that no live file, photo or certificate uses the key.

## Tests that prove it

`tests/storage-deletion.test.ts` (outbox, triggers, worker, races), `tests/upload-sweep.test.ts` (ledger and sweep), `tests/direct-upload.test.ts`, `tests/s3-storage.test.ts` (signed requests, version deletion with a fake versioned bucket), `e2e/upload-sweep.spec.ts` (HTTP endpoint, unauthorized calls), `e2e/b2-browser-upload.spec.ts` (real browser and real bucket, opt-in, needs the CORS rule), `scripts/b2-selftest.mts` (real bucket, server side).

## Audit scope of the final stabilization pass (honest limits)

Scripted checks over the whole source: all 93 API route files (the 10 without an inline authentication check are the intended public ones: health, the auth entry points, certificate verification and the public event pages), no `dangerouslySetInnerHTML` except the JSON-LD block that escapes `<`, no `eval`/`new Function`, all raw SQL (25 statements) is parameterized tagged templates with no string-built or `Unsafe` variants, security headers (HSTS, nosniff, frame denial, referrer policy, permissions policy, CSP) and `__Host-` HttpOnly Secure SameSite cookies in production, no console output in server code. Dynamic checks: 471+ Vitest tests and the Playwright suite (authorization matrix, session, MFA, rate limits, CSRF/Origin, upload privacy, blind judging, results gating, certificates), plus a responsive and runtime-health sweep of 27 pages across all roles at 320, 360, 390, tablet and desktop widths. **Not done:** a manual line-by-line review of every file, an independent penetration test, real-device and screen-reader testing, and any test against a deployed site.

## Bugs found and fixed in the stabilization pass

| Bug | Root cause | Fix and regression test |
|---|---|---|
| `/admin/leadership` overflowed 32 px at 320 px wide | a long-label button could not wrap (`whitespace-nowrap` in the shared button base) | new `wrap` button size; the responsive sweep (135 page-and-width checks) fails if any page overflows |
| Content stayed invisible for up to 300 ms for people who prefer reduced motion | the reduced-motion rule collapsed animation durations but not the staggered animation delays | delays collapsed too; `e2e/responsive-sweep.spec.ts` "reduced motion" test (verified to fail without the fix) |
| Navbar overflowed at 320 px after the wordmark size change | 20 px bold wordmark plus buttons exceeded the width | 17 px below 360 px, 20 px above; caught by the hero layout test |
