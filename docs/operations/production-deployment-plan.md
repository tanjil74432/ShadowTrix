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

The preflight (`OPTIONS`) the browser sends: `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: content-type`, and the page `Origin`.

**Root cause (verified 2026-11-17).** The bucket had no usable CORS rule: the preflight from the production origin returned HTTP 403 with no `Access-Control-Allow-Origin`, so a real Chromium on the production site blocked the upload. S3 `PutBucketCors` cannot be used on this bucket once Native-API rules exist (Backblaze refuses it), so the rule is applied with the B2 Native API (`b2_update_bucket`, application key with `writeBuckets`). A console preset that had been applied earlier was replaced by the rule below.

**Applied and verified on 2026-11-17.** The bucket is private (`allPrivate`) and carries exactly the rule below. Preflight results: production origin -> 200 with `Access-Control-Allow-Origin: https://shadow-trix-woad.vercel.app`; `https://evil.example` -> 403; `http://localhost:3012` -> 403 (it is added only temporarily for the local browser test and removed afterwards). A real Chromium uploaded a throwaway object from the production origin, and the real-bucket end-to-end spec (local app, real bucket, real Chromium) passes: upload, attach, private-access checks, signed-download redirect, immutability after tampering, outbox deletion of every version, and an empty bucket afterwards. **Not performed: the complete flow on the production site while signed in** (it needs a production account, which does not exist yet).

Required rule (facts from Backblaze's CORS documentation: rule names are 6 to 63 letters, digits and hyphens and must not start with `b2-`; `allowedOrigins` takes full origins; `allowedHeaders` is optional and lowercase header names are safest; `maxAgeSeconds` is required and at most 86400; the S3 PUT operation is "S3 Put Object" in the console and `s3_put` in JSON):

```json
[
  {
    "corsRuleName": "shadowtrix-browser-upload",
    "allowedOrigins": ["https://shadow-trix-woad.vercel.app"],
    "allowedOperations": ["s3_put"],
    "allowedHeaders": ["content-type"],
    "exposeHeaders": [],
    "maxAgeSeconds": 3600
  }
]
```

No wildcard origin is needed or wanted. For local browser testing add `http://localhost:3010` and `http://localhost:3012` to `allowedOrigins`. Add the production origin exactly (`https://`, no trailing slash); if the site later gets a custom domain, add that origin too. Keep the bucket **Private**. Rules created through the API or CLI may not appear in the web console.

Verification, in this order: (1) `B2_BROWSER=1 npx playwright test --config=playwright.b2.config.ts` (local app, real bucket, real Chromium, needs the `localhost:3012` origin); (2) the production-origin probe (a throwaway object under `selftest/`, a real browser PUT from `https://shadow-trix-woad.vercel.app`, then cleanup). **CORS is "working" only when a real browser upload succeeds.**

## 6. Email

Gmail 2-step verification on, an App Password created by the owner (16 characters, shown once), stored only in the host's environment settings as `SMTP_PASSWORD`. `SMTP_USER` and `EMAIL_FROM` are the Gmail address.

**Required production variables:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`.

**Behavior when they are missing (verified by tests, not by a real inbox).** On a public deployment, registration, verification resend, password reset and team invitations return `503 email_unavailable` with a generic message, create no account or token, and reveal no variable name; the sign-up and password-reset pages show that message. `/api/v1/health` reports `email: not_configured`. The server log names the missing variables (names only). A mail transport failure after the request was accepted is logged and audited (`email.delivery_failed`) with only a short error code, never a message, recipient or credential.

**Owner action required:** set the three missing variables in Vercel (Production scope) and redeploy. **Pending:** real delivery to an inbox is verified only by a real registration on the live site after that.

## 7. Scheduling

`web/vercel.json` registers one daily job: `GET /api/v1/internal/cleanup` at 03:00 (UTC, within an hour or so on Hobby). The route needs `Authorization: Bearer <CRON_SECRET>` (Vercel sends it when the `CRON_SECRET` environment variable is set; **unverified until the first run**). The job: housekeeping, expire abandoned uploads, then drain the storage-deletion outbox. Files orphaned by deletions are also deleted immediately after each commit (best effort), so the daily job is a safety net, not the only path.

## 8. Domain and HTTPS

`https://<project>.vercel.app` with automatic HTTPS. A custom domain is optional and is not free (a domain purchase), so none is assumed. `APP_URL` must equal the public origin: it is used in email links, cookies are `Secure` and `__Host-` prefixed in production, and the CSP `connect-src` includes the B2 endpoint origin at build time (so `S3_ENDPOINT` and `STORAGE_DRIVER` must be set in the **build** environment too).

## 9. Rollback

Code: promote the previous successful production deployment in the Vercel dashboard (availability of instant rollback on Hobby is **unverified**; redeploying the previous commit or local snapshot always works). Data: migrations are additive; accidental data loss is covered by Neon's restore window. Files: B2 objects are only deleted through the outbox with the guards described in the security review.

## 10. Expected free-tier limitations

Cold start after 5 idle minutes on Neon (a slow first page), a daily-only scheduler with up to an hour of drift, about 500 emails a day, 10 GB of files, Vercel's 4.5 MB function body limit (files bypass it), and the non-commercial restriction.

**Incident 2026-11-17: verification email not delivered.** Production recorded `email.delivery_failed` with `EAUTH`, SMTP reply 535, command `AUTH PLAIN` (Gmail rejected the login; host, port and STARTTLS were correct). The send runs after the HTTP response (`after()`), so the caller still sees the same neutral 202 by design; the failure is visible only in the audit log (`email.delivery_failed`) and the function log. Fix shipped: credentials are cleaned when the environment is read (wrapping quotes, whitespace, trailing newline, and for Gmail the spaces of the app password), and a login rejection now also stores booleans and the password length (never a value) so the cause can be told apart. A changed `SMTP_PASSWORD` only takes effect on a new deployment.
