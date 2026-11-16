# Production deployment plan (free tier, $0)

Status of every statement is marked **verified** (checked on the provider's own page or by a real test on 2026-11-16), **from reports** (secondary sources, treat as approximate) or **unverified** (must be confirmed in the real environment). Nothing here activates a paid plan.

## 1. Architecture

One Next.js 16 application (unchanged architecture): hosting runs the app, Neon holds the data, Backblaze B2 holds private files, SMTP sends mail, and the host's scheduler calls the maintenance endpoint.

```
Browser --HTTPS--> Vercel (Next.js, serverless functions)
                     |-- pooled connection --> Neon PostgreSQL (us-east-2)
                     |-- signed requests ----> Backblaze B2 bucket "shadowtrix" (private, us-east-005)
                     |-- SMTP 587 STARTTLS --> Gmail (App Password)
Browser --signed URL, PUT/GET--> Backblaze B2 (files never pass through the app)
Vercel Cron (daily) --GET + Bearer CRON_SECRET--> /api/v1/internal/cleanup
```

## 2. Providers, reasons, limits

| Need | Choice | Why | Free-tier facts |
|---|---|---|---|
| Hosting | **Vercel Hobby** (candidate; see the terms caveat) | Native Next.js 16 support, automatic HTTPS, no card needed *(unverified at sign-up)* | 100 GB fast data transfer, 1M invocations, 4 CPU-hours, 360 GB-hours a month, functions up to 300 s (**verified**). Over the limit the feature is blocked for 30 days, not billed (**verified**). Request bodies are limited to 4.5 MB (**verified**), which is why files go directly to B2. **Hobby is for personal, non-commercial use only (verified); commercial use needs Pro.** The owner must confirm ShadowTrix stays non-commercial (no fees, ads or sponsor money to anyone involved). If not, use another host. |
| Database | **Neon Free** (already created and migrated) | Real PostgreSQL, same engine as development | 1 GB per project, 100 compute-hours, scales to zero after 5 minutes idle (the first request after idle is slower) (**verified**). Restore window 6 hours and 10 branches per project (**from reports**). |
| Files | **Backblaze B2** (bucket `shadowtrix`, private) | No card at sign-up, S3 API, free egress up to 3x stored data | 10 GB free (**verified**). Live self-test passed (private access, signed upload/download, size and type binding, deletion of all versions). |
| Email | **Gmail SMTP with an App Password** | Free, no domain needed | About 500 recipients a day for a personal account (**from reports**). Mail is sent from the Gmail address (`EMAIL_FROM` must be that address). Needs 2-step verification. |
| Scheduler | **Vercel Cron** | Included | Hobby: once a day, run time anywhere within the chosen hour plus up to 59 minutes (**verified**). |
| Repository | GitHub (existing) | n/a | Nothing is pushed until the owner approves. Deployment can be done with the Vercel CLI from the local files. |

Free tiers are not unlimited: the weakest points are Hobby's commercial-use rule, Neon's cold start, Gmail's daily cap and B2's 10 GB.

## 3. Environment variables (names only; values live in the host)

`DATABASE_URL` (Neon **pooled** URL), `APP_URL` (`https://<project>.vercel.app`), `AUTH_SECRET` (new, 32+ characters), `CRON_SECRET` (new, 32+), `TRUST_PROXY=true`, `ENABLE_STYLEGUIDE=false`, `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION` (optional for B2), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `PENDING_UPLOAD_TTL_MINUTES=120`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. `DIRECT_URL` is **not** used: Prisma reads only `DATABASE_URL`; migrations are applied from the owner's machine with `scripts/neon.mjs` using the direct URL, never from the host.

`npx tsx --conditions=react-server scripts/prod-env.mts generate` writes `web/.env.production.local` (git-ignored) with new secrets and the Neon and B2 values copied locally; `check` validates it with the application's own schema (https `APP_URL`, strong `AUTH_SECRET`, pooled database host, no development flags). No value is printed. Development secrets are never reused.

## 4. Database migration strategy

- Production database: Neon `production` branch. Migrations are applied only with `node scripts/neon.mjs deploy` (guarded: Neon host only, direct connection, refuses an unknown non-empty database) and verified with `node scripts/neon.mjs verify`.
- Repository has 13 migrations. Neon had 11 until the two new ones (`pending_uploads`, `storage_deletion_outbox`) are applied. Both are additive (two tables, one enum each, three triggers, CHECK constraints); they delete and modify no existing data.
- Before applying: `check` (read-only) must show the expected 11 recorded migrations and the data counts. The Neon database contains no users, events or files, so a backup protects nothing yet; a Neon branch created from `production` before the first real data arrives is recommended (Neon console, free, 10 branches).
- Never `db push`, reset or drop. Rollback of a migration is a forward fix (additive migrations are harmless to leave in place); Neon's restore window covers accidental data loss for 6 hours.

## 5. Storage bucket and CORS

The browser PUTs the file straight to `https://s3.us-east-005.backblazeb2.com/shadowtrix/<key>?X-Amz-...` (signed for one key, one content type, one exact length, 15 minutes). That is a cross-origin request, so the bucket needs a CORS rule. Downloads are top-level navigations (a redirect to a 60-second signed URL), which need no CORS.

The preflight (`OPTIONS`) the browser sends: `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: content-type`, and the page `Origin`. Required B2 CORS rule (Backblaze console > Buckets > shadowtrix > CORS Rules > custom rule; field names as of this writing, confirm in the console):

```json
[
  {
    "corsRuleName": "shadowtrix-browser-upload",
    "allowedOrigins": ["https://<project>.vercel.app", "http://localhost:3010", "http://localhost:3012"],
    "allowedOperations": ["s3_put"],
    "allowedHeaders": ["content-type"],
    "exposeHeaders": [],
    "maxAgeSeconds": 3600
  }
]
```

Add the final production origin (exactly, with `https://` and no trailing slash). Keep the bucket **Private**. **CORS is NOT verified until a real browser upload succeeds**: `node scripts/b2-selftest.mts` reports preflight results as advisory, and `e2e/b2-browser-upload.spec.ts` (opt-in, run after the rule exists) performs a real Chromium upload through the real page.

## 6. Email

Gmail 2-step verification on, an App Password created by the owner (16 characters, shown once), stored only in the host's environment settings as `SMTP_PASSWORD`. `SMTP_USER` and `EMAIL_FROM` are the Gmail address. Real delivery is verified only by a real registration on the live site.

## 7. Scheduling

`web/vercel.json` registers one daily job: `GET /api/v1/internal/cleanup` at 03:00 (UTC, within an hour or so on Hobby). The route needs `Authorization: Bearer <CRON_SECRET>` (Vercel sends it when the `CRON_SECRET` environment variable is set; **unverified until the first run**). The job: housekeeping, expire abandoned uploads, then drain the storage-deletion outbox. Files orphaned by deletions are also deleted immediately after each commit (best effort), so the daily job is a safety net, not the only path.

## 8. Domain and HTTPS

`https://<project>.vercel.app` with automatic HTTPS. A custom domain is optional and is not free (a domain purchase), so none is assumed. `APP_URL` must equal the public origin: it is used in email links, cookies are `Secure` and `__Host-` prefixed in production, and the CSP `connect-src` includes the B2 endpoint origin at build time (so `S3_ENDPOINT` and `STORAGE_DRIVER` must be set in the **build** environment too).

## 9. Rollback

Code: promote the previous successful production deployment in the Vercel dashboard (availability of instant rollback on Hobby is **unverified**; redeploying the previous commit or local snapshot always works). Data: migrations are additive; accidental data loss is covered by Neon's restore window. Files: B2 objects are only deleted through the outbox with the guards described in the security review.

## 10. Expected free-tier limitations

Cold start after 5 idle minutes on Neon (a slow first page), a daily-only scheduler with up to an hour of drift, about 500 emails a day, 10 GB of files, Vercel's 4.5 MB function body limit (files bypass it), and the non-commercial restriction.
