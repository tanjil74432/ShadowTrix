# Milestone 4 Report: Authentication and Authorization

Date: 2026-11-15 · Branch: `feature/milestone-4-authentication` (stacked on `feature/milestone-3-design-system`)
Delivered together with the Milestone 3 integration work as Combined Work Package 01.

**Status: implemented and verified in a fresh clone. Not merged; awaiting your review.**

## 1. What was built

| Capability | Result |
|---|---|
| Registration | Complete. Validated, rate-limited, enumeration-resistant (identical response for new, unverified and existing addresses). |
| Email verification | Complete. 24-hour single-use link; opening the link only shows a page, a button press consumes the token (mail scanners cannot burn it). Resend supported. |
| Login / logout | Complete. Generic errors until the password is proven; logout revokes the session on the server. |
| Forgot / reset password | Complete. 60-minute single-use link; reset revokes every session, voids other links, notifies the owner. |
| Sessions | Complete. Server-side, absolute 30-day and 7-day idle expiry, revocation, new token at each login. |
| RBAC | Complete. Pure permission matrix with scoped grants; enforced on pages (access-denied view, protected content never rendered) and APIs (401/403); roles always read from the database. |
| Protected routes and APIs | `/dashboard`, `/organizer`, `/judge`, `/admin`, `GET /auth/me`, and the admin user API. |
| Admin user management | API complete (list, grant/revoke role, suspend/reactivate) with safeguards; UI is a read-only user list only. |
| First administrator | `npm run admin:grant -- <email>` (no default credentials exist). |
| Rate limiting | Complete. Postgres-backed fixed windows per account and (when trustworthy) per IP. |
| CSRF | Complete. Origin / Sec-Fetch-Site check plus JSON-only bodies, enforced centrally. |
| Validation and errors | Zod on every input; uniform error shape; no internals in responses. |
| Auth models and migrations | `sessions`, `rate_limits`, CHECK constraints, partial unique index. |

Not built (carried forward, listed in the roadmap): change-password for signed-in users, email change, MFA, social login, "sign out other devices", scheduled cleanup, CSP, periodic rotation of a live session token, management UI for admins.

## 2. Architecture and database changes

- New modules: `auth`, `authz`, `admin` (user management), `email`, `audit`, plus `security` (rate limit, CSRF, tokens, client IP) and `logging`. Layering and the lint rule keeping data access out of UI code are unchanged.
- Migration `20261115121032_auth_sessions_and_rate_limits` (additive; no existing migration touched). The generated SQL was reviewed and extended **before** it was applied, and it no longer tries to drop any hand-written index (the problem found in Milestone 3). Fresh-database apply: passes; `prisma migrate diff`: no drift.
- Prisma client is generated as CommonJS (Playwright's loader cannot import the ESM output).
- Environment: `TRUST_PROXY`, `SESSION_ABSOLUTE_TTL_DAYS`, `SESSION_IDLE_TTL_DAYS`; `AUTH_SECRET` is now meaningful; production rejects placeholder secrets and non-https public URLs ([environment-variables.md](../architecture/environment-variables.md)).
- Security headers added in `next.config.ts`.

## 3. Security measures

Full table with the test that proves each one: [authentication.md](../architecture/authentication.md). In short: Argon2id (64 MiB, 3 passes); 256-bit random tokens stored only as SHA-256; atomic single-use claims (exactly one winner under 6 to 8 concurrent submissions); HttpOnly, SameSite=Lax session cookie (Secure and `__Host-` on https) that never appears in a response body; server-side revocation; identical cost and responses for known and unknown accounts; HMAC-keyed rate-limit keys (no emails or IPs stored); Origin-based CSRF; open-redirect allow-list; redacting logger; HTML-escaped emails without passwords; allow-list response objects (no hashes); advisory-lock-serialised admin changes; `no-store` on API responses and `no-referrer` on token pages; clickjacking, sniffing and HSTS headers.

Issues found and fixed **during** this work (not hidden):

| Issue | Impact | Fix |
|---|---|---|
| The API error handler swallowed Next.js control-flow errors (dynamic-rendering bailouts) and logged them as failures | Noisy logs; would also break `redirect()` and `notFound()` inside handlers | Re-throws them with `unstable_rethrow` |
| Reading the clock in session validation during Next.js's runtime prerender pass | Error logged on every request | `connection()` marks session lookup as request-time |
| The admin user table's horizontal scroll area was not keyboard-focusable (caught by axe at 360 px) | WCAG 2.1.1 / axe `scrollable-region-focusable` | Focusable, labelled region |
| Mobile menu stayed open after clicking a link to the page you were already on | UX bug | Close on any link click inside the account area |
| No way to create the first administrator | Admin API unusable on a fresh deployment | `npm run admin:grant` |
| Test suites left test users and audit rows in the dev database | Polluted data | Cleanup in both suites plus a namespace sweep before/after e2e |

## 4. Tests actually executed

| Suite | Result | Notes |
|---|---|---|
| Unit and database-backed integration (Vitest) | **213 / 213 pass** (10 files) | real PostgreSQL; Argon2, tokens, CSRF, client IP, redirects, cookies, redaction, email templates, 55-cell RBAC matrix, registration, verification, login, sessions, reset, rate limiter, admin service, first-admin bootstrap, DB constraints |
| End-to-end (Playwright, Edge locally) | **63 / 63 pass**, run three times in a row without a failure | real SMTP via Mailpit, real PostgreSQL, production build; journey, reset, sessions, role matrix on pages and APIs, CSRF, enumeration, rate limiting, WCAG 2.2 AA on every account page at 360 and 1440 px |
| Fresh-clone simulation of CI | **all steps pass** | `npm ci`, schema validate, **fresh database** migrate, drift check, seed, typecheck, lint, tests, build, e2e, audit |
| Typecheck (strict) / ESLint | pass / pass | |
| Production build | pass | no runtime errors in server log |
| `npm audit` | production: **0 vulnerabilities**; all: 7 moderate, all in dev-only ESLint tooling | |
| Linux Chromium (Playwright Docker image, CI conditions) | M3 suite 24 / 24 pass | used to investigate the Milestone 3 CI failure |
| **GitHub Actions on this branch** | **success** (run on `75af64b`): all 15 steps pass, including fresh-database migrations, drift check, 213 unit/integration tests, production build, 63 Playwright tests against a Mailpit service container (Linux Chromium), and the dependency audit | warnings only: GitHub's Node 20 action deprecation notice |

Test-count breakdown by file: admin-users 12, auth-password 11, auth-security-units 19, auth-service 36, authz 11 (expands to 55 matrix cases), db-integrity 18, design-tokens 4 (expands to 20), env 8, event-logic 10, grant-admin 3.

Tests that deliberately do **not** exist yet: load/performance, penetration testing, Firefox/WebKit, real-device and screen-reader testing, email rendering across mail clients.

## 5. Files

100 files changed against the Milestone 3 tip (76 created, 24 modified; 5,390 lines added, 98 removed): `web/src/app` 21 (pages and API routes), `web/src/server` 20, `web/src/components` 15, `web/tests` 9, `web/e2e` 4, `web/prisma` 3, docs 19, configuration 9.

Key new files: `web/src/server/modules/auth/{auth.service,session.service,password,dal,session-cookie,auth.schema}.ts`, `web/src/server/modules/authz/permissions.ts`, `web/src/server/modules/admin/admin-users.service.ts`, `web/src/server/security/{rate-limit,csrf,tokens,client-ip}.ts`, `web/src/app/api/v1/**/route.ts`, `web/src/components/auth/*`, `web/prisma/grant-admin.ts`, migration `20261115121032_*`, `web/e2e/auth.spec.ts`. Modified: header and mobile menu, `next.config.ts`, CI workflow, Playwright and ESLint config, environment schema, API handler.

Screenshots: `docs/design/screenshots/m4-*.png`.

## 6. Git, branches and pull requests

- Branches on GitHub: `main` and `develop` (Milestone 2), `feature/milestone-3-design-system`, `feature/milestone-4-authentication`, and the temporary `temp/identity-check` (left in place).
- Commit author and committer on every commit: Tanjil Shaiket, verified GitHub account `tanjil74432`; no AI trailers. History was **not** rewritten in this work package (the earlier approved cleanup was a separate task).
- M4 commits: `38e3f91` (tables), `8094fe2` (server code), `c0fe895` (UI, e2e, CI), `ae76e8a` (merge of M3 CI fixes, a normal merge commit), `c55776a` (bootstrap, cleanup, docs), plus the report commit.
- **No pull request is open.** `gh` is not installed and credentials are not handled; descriptions and compare links are ready in [pull-requests.md](pull-requests.md). Branch-protection settings cannot be read without authentication, so they are unknown.
- Nothing was merged or force-pushed.

## 7. Known issues and technical debt

See "Known limitations" in [authentication.md](../architecture/authentication.md). The ones that matter most: no scheduled cleanup; no CSP; no signed-in password change or MFA; pre-registration risk reduced but not eliminated; pages are no longer CDN-cacheable because the header is session-aware; `APP_URL` must match at build and run time; the footer's "Account" column still shows Login/Register when signed in (those links redirect to the dashboard); authentication is self-reviewed, not independently audited.

Other notes: GitHub reports that the `actions/checkout@v4` and `actions/setup-node@v4` actions run on a deprecated Node 20 runtime (a warning, not a failure); the Mailpit service in CI uses the `latest` tag; Playwright runs Edge locally and Chromium in CI.

## 8. Approvals and decisions needed from you

1. **Open and merge the pull requests**, M3 first, then M4 (I will not merge into `develop` or `main`).
2. **Who is the first administrator?** Register that account on a running instance, confirm the email, then run `npm run admin:grant -- <email>` (or tell me to do it for a development account).
3. **Policy choices to confirm:** 30-day absolute / 7-day idle sessions; password minimum of 10 characters; 8 login attempts per 15 minutes per account. All are one-line settings.
4. **Pre-registration hardening:** to remove the residual risk completely, accounts could set their password only after confirming the email. It changes the signup flow, so I did not do it without your decision.
5. **Before Milestone 5:** do you want change-password for signed-in users and MFA first, or carried forward as listed?
6. **An independent security review** (and penetration test) before any real user data is handled.
7. **Deployment:** `TRUST_PROXY` and `APP_URL` depend on the hosting choice (still open).
8. **Milestone 5 has not been started** and will wait for your review.
