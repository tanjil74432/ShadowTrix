# Outstanding bug fix report

Date: 2026-11-17. Branch: `feature/milestone-5-6-events-dashboards` (nothing merged to `main` by this work, nothing deployed). Audited commit: `26fc1f84e72098abde53e3db08482b991df2d04a`. The fix commit and its CI result are in section 12.

Statuses: **FIXED & VERIFIED**, **FIXED, EXTERNAL VERIFICATION PENDING**, **NOT FIXED**, **BLOCKED, OWNER ACTION REQUIRED**.

## Summary

| # | Item | Status |
|---|---|---|
| 1 | CI for the audited commit | **FIXED & VERIFIED** (green, both runs) |
| 2 | Backblaze B2 browser upload (CORS) | **FIXED & VERIFIED** for the browser-to-bucket leg; full signed-in flow on the production site **pending** (no production account yet) |
| 3 | SMTP configuration handling | **FIXED & VERIFIED** (code and tests); **BLOCKED, OWNER ACTION REQUIRED** for credentials and real inbox delivery |
| 4 | Anonymous upload returned 415 | **FIXED & VERIFIED** |
| 5 | Mobile header overflow | **FIXED & VERIFIED** |
| 6 | Server-side `put` rejected by B2 (HTTP 411), found while verifying 2 | **FIXED & VERIFIED** (unit test and real bucket) |
| 7 | Production deployment and first-administrator docs | **FIXED & VERIFIED** (reviewed against evidence; owner actions listed) |

## 1. CI for commit 26fc1f8

Actual result (GitHub Actions API, not assumed): run 43947893980 on the feature branch and run 43949404564 on `main` for `26fc1f84`, both `completed / success`. The feature-branch run: install, Prisma validate, migrations on a clean database, drift check, seed, typecheck, lint, unit/security/authorization/integrity tests, build, Playwright (133 passed, 6 skipped) and dependency audit all passed. The two earlier failures (`c7a004e2`, `18e881f3`) were genuine and had been fixed in code (a local-only file read at module load; the header placeholder, item 5), not by weakening tests.

## 2. B2 CORS and browser upload

- **Original issue.** A real browser on the production origin could not PUT to the bucket.
- **Cause (verified).** The bucket had no usable CORS rule: the preflight from `https://shadow-trix-woad.vercel.app` returned 403 with no `Access-Control-Allow-Origin`. S3 `PutBucketCors` is refused by Backblaze once Native rules exist, so the rule must be set with the B2 Native API (`b2_update_bucket`). A console preset applied earlier was replaced.
- **Fix.** One rule, applied through the Native API: origin `https://shadow-trix-woad.vercel.app` only (no wildcard), operation `s3_put`, allowed header `content-type`, no exposed headers, max age 3600 s. Bucket stays `allPrivate`. No secret appears in code, docs or logs. Exact JSON is in `docs/operations/production-deployment-plan.md` section 5.
- **Evidence.** Preflight now: production origin 200 with a matching `Access-Control-Allow-Origin`; `https://evil.example` 403; `http://localhost:3012` 403. A real Chromium on the production origin uploaded a throwaway object and it was cleaned up. The local-app, real-bucket, real-Chromium spec (`B2_BROWSER=1 npx playwright test --config=playwright.b2.config.ts`, with `localhost:3012` added temporarily and removed after) passes: upload, attach, anonymous access refused, stranger gets 404, owner gets a 307 to a 60-second signed URL, tampering with the temporary object through the old signed URL does not change the attached object, the outbox deletes every version. The bucket was empty afterwards (0 objects or versions).
- **Test fixes made on the way.** The spec hung because it logged in as a second user while still signed in (the login page redirects a signed-in user away); it now clears the session first. Raw bucket requests have 30-second timeouts so a stall fails loudly. The tamper payload now has the exact same length as the original.
- **Files.** `web/e2e/b2-browser-upload.spec.ts`, `web/playwright.b2.config.ts`, docs.
- **Still required.** The complete signed-in flow on the live site needs a production account (none exists). If a custom domain is added, add its origin to the rule.

## 3. SMTP

- **Original issue.** Missing mail configuration could make registration appear to work while no email was ever sent.
- **Fix.** `web/src/server/modules/email/email-config.ts` decides readiness on a public deployment only (production build and a non-local `https` `APP_URL`). When not ready, registration, verification resend, password reset and team invitations return `503 email_unavailable` (generic message, no variable names, identical for every caller so accounts cannot be enumerated), create nothing, and the log names the missing variables. `SMTP_USER` without `SMTP_PASSWORD` (or the reverse) is a startup error that never echoes a value. A transport failure after acceptance is logged and audited as `email.delivery_failed` with only an error code, reply code and command verb (shape whitelists; messages, recipients and credentials are never stored). `/api/v1/health` reports `email: ready|not_configured`.
- **Evidence.** `web/tests/email-config.test.ts` (13 tests) and `web/e2e/email-unavailable-ui.spec.ts` (2 tests, the sign-up and reset pages show the message). Development, CI and e2e remain "ready" because they use the local mail sink on purpose.
- **Owner action required.** Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD` (Gmail App Password), `EMAIL_FROM` in Vercel (Production scope) and redeploy. **Real inbox delivery was not tested and is not claimed.** No credentials were invented.

## 4. Upload endpoints: 415 before authentication

- **Original issue.** An anonymous POST to a photo upload returned 415 instead of an authentication response.
- **Cause.** The content-type check ran in the shared handler before the route's own authentication.
- **Fix.** For the two multipart routes, order is now origin (403), authentication (401), authorization (403), content type (415), size, parsing, validation (411/413/400). The check is enforced twice: routes call `assertMultipart` right after their authorization, and the handler hands them a request wrapper (`guardMultipartBody`) that enforces it on the first body read, so a future route cannot read the body without it. JSON endpoints keep their documented order. 415 was not converted to 401 in general.
- **Files.** `web/src/server/security/csrf.ts`, `web/src/server/http/handler.ts`, the two route files, `docs/api/auth-and-admin-api.md`.
- **Evidence.** Before: anonymous JSON to the photo route returned 415. After, in `web/e2e/upload-auth-order.spec.ts` for both routes: no or foreign Origin 403; anonymous with valid multipart, JSON, text, multipart without boundary, malformed multipart or no body 401; signed-in non-administrator 403 on the photo route; authorized JSON, text, no-boundary 415; authorized malformed 400, wrong field 400, disallowed type 400; authorized valid 201; refused requests stored nothing. Plus `web/tests/multipart-guard.test.ts` (6 tests).

## 5. Mobile header overflow

- **Fix (already in 26fc1f8).** The header's loading placeholder in `web/src/components/layout/navbar.tsx` is `hidden h-9 w-40 md:block` so it no longer reserves 160 px on phones.
- **Evidence.** With the fix: the responsive spec (every page, every role, 320/360/390/tablet/desktop, plus a per-frame transient overflow check at 320 and 340 px and a reduced-motion check) passes, 3 of 3. Controlled experiment: with the class temporarily removed the transient overflow test failed (`/login` at 320 px: widest overflow 71 px); the file was restored and is identical to HEAD; no backup or temporary file remains.

## 6. Server-side put rejected by B2 (411)

- **Found** by the real-bucket run: the server-side `put` inside Next.js got `411 MissingContentLength` because the patched fetch sends a streamed body without a length.
- **Fix.** `web/src/server/storage/s3-storage.ts` sends an explicit `Content-Length`; unit test in `web/tests/s3-storage.test.ts`. The copy-step failure path now logs a safe reason (`upload.copy_failed`) before returning 503.
- **Evidence.** Unit test, and the real-bucket spec passes twice in a row against the real bucket.

## 7. Documents

`docs/operations/production-deployment-plan.md` (CORS root cause, applied rule and what was and was not verified; SMTP variables, behavior and owner action) and `docs/operations/first-administrator.md` (status 2026-11-17: still not granted in production; MFA is built; the grant command needs the Neon direct URL for that one command only) were reviewed against the evidence above. `docs/api/auth-and-admin-api.md` and `docs/architecture/environment-variables.md` document the new behavior. No secrets appear in them.

## 8. Commands run locally (all on this work tree)

`tsc --noEmit`: clean. `eslint .`: clean. `vitest run`: 27 files, 505 tests passed. `prisma validate`: valid. `prisma migrate status`: 13 migrations, up to date. `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities. `next build`: succeeded. `playwright test --project=chromium`: see section 12. Secret scan of the diff and the new files: only variable names matched, no values.

## 9. External configuration still required (owner)

1. Vercel Production: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, then redeploy.
2. After that, register on the live site and confirm a real verification email arrives (only then is delivery proven).
3. Create the first administrator by the steps in `first-administrator.md` after explicit owner confirmation.
4. Confirm Vercel Hobby's non-commercial terms apply.

## 10. Blockers

Real email delivery (no credentials exist) and the signed-in production flow (no production account exists). Both are owner actions, not code defects.

## 11. Production readiness implications

The code-side defects from the audit are fixed and regression-tested. The deployed site still sends no email until the owner sets the SMTP variables; until then sign-up shows a clear "email unavailable" message instead of pretending to succeed. The bucket accepts browser uploads only from the production origin. Nothing was deployed or merged by this work.

## 12. Branch, commit and CI for the fix

Filled in after the push (see the end of this file).
