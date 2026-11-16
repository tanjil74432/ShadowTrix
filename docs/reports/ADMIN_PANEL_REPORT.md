# Admin panel completion report

Branch `feature/milestone-5-6-events-dashboards`. Starting point: commit `6a8353d` (CI for it: run 43965364890, success). Nothing was merged to `main` and nothing was deployed by this work. Final commit and CI: section 10.

## 1. Existing admin panel (audit before coding)

- **Pages (11):** overview, users (+detail), events (+detail), organizations (+detail), leadership (+member detail, banner creator), analytics, audit, settings.
- **API (28 admin routes + upload):** users (list, detail, status, roles), events (list, organizers, hosts), organizations (CRUD, verify, representatives), leadership (units, designations, terms, members, memberships, photo), audit, analytics, settings. Every route calls `requireApiPermission("admin:access")`; every service starts with `assertAdmin`.
- **Permissions:** `admin:access`, `users:read`, `users:manage` exist; only the global `ADMIN` role holds them (an event-scoped ADMIN grant does not). No new permission was needed.
- **Existing capabilities reused instead of duplicated:** results publish/unpublish, certificate revoke, disqualify, scorecard reopen, signed submission download (`authorizeRead` already admits administrators), audit log, `SiteSetting`, health.
- **Not present at all:** an event approval state, an announcements service (the table existed but nothing used it), a maintenance mode, admin views of teams, submissions, judging, results and certificates.

## 2. Feature gap analysis and decisions

| Requested | State before | Decision |
|---|---|---|
| Overview with real statistics | 6 cards | Rebuilt: users (verified, unverified, active, suspended), events (draft, published, ongoing, completed, cancelled, awaiting approval), organizations (unverified), teams, submissions, awaiting judging, published results, certificates issued/revoked, alerts, recent activity. All from queries. |
| Event approval | none; organizers publish directly | **Added as a review layer separate from publishing.** Organizer submits a draft; administrator approves, rejects (reason) or requests changes (reason); history in the audit log. It gates publishing only when the new setting "Event approval required" is on (default off, so no existing workflow changes). Administrators are exempt. |
| Teams, submissions, judging, results, certificates | not visible to admin | New read-focused consoles reusing existing action endpoints. |
| Suspend/deactivate a team | not supported (leaders disband) | **Not added**: "only if supported by existing business rules". |
| Score override | not supported | **Not added**: judges own scores; reopening stays the audited, reasoned existing action. |
| Announcements | table unused | Full management (draft, edit, publish now, schedule, unpublish, delete draft), audiences, optional event, shown on the signed-in dashboard. Scheduling needs no worker: readers filter on the clock. |
| Maintenance | none | Read-only mode (one `SiteSetting`), health panel, history. |
| Request changes | n/a | Supported (`CHANGES_REQUESTED`, organizer resubmits). |

## 3. New admin pages

Event approvals (+review), Teams (+detail), Submissions (+detail), Judging (+event progress), Results (+event rankings), Certificates, Announcements (+new, +detail/edit), Maintenance; overview rebuilt; settings gained the approval switch; navigation now: Overview, Users, Organizations, Events, Event approvals, Teams, Submissions, Judging, Results, Certificates, Announcements, Leadership, Banner creator, Analytics, Audit logs, Maintenance, Settings. Organizer event page shows review status and "Submit for review". Dashboard shows announcements. Maintenance banner on every page while the mode is on.

## 4. New or changed endpoints

Documented in `docs/api/admin-api.md` ("Administration consoles"). New: `GET /admin/overview`, `/admin/event-reviews` (+`/{id}`, `POST` decision), `POST /events/{id}/review-request`, `/admin/teams` (+`/{id}`), `/admin/submissions` (+`/{id}`), `/admin/judging` (+`/{id}`), `/admin/results` (+`/{id}`), `/admin/certificates`, `/admin/announcements` (+`/{id}` GET/PUT/DELETE, `/publish`, `/unpublish`), `/admin/maintenance` (GET/PUT). Changed: `PATCH /admin/settings` accepts `eventApprovalRequired`; every state-changing API call now passes the maintenance check (`apiHandler`).

## 5. Database changes

One additive migration `20261120090000_admin_panel` (no existing data touched, safe defaults): enums `EventReviewStatus`, `AnnouncementAudience`; `events` gets `review_status` (default `NOT_SUBMITTED`), `review_note`, `reviewed_at`, `reviewed_by_id` (FK, `SET NULL`), an index and a CHECK that a rejection or change request carries a reason of at least 5 characters; `announcements` gets `audience`, `updated_at`, `updated_by_id`. No new tables. Verified: applies on a clean database, `prisma migrate diff` shows no drift. **Not applied to the production database** (applying it is a separate, owner-approved step: `node scripts/neon.mjs deploy`).

## 6. Permission matrix

| Capability | Anonymous | Participant / Judge | Organizer | Administrator |
|---|---|---|---|---|
| Any `/admin` page or `/api/v1/admin/*` endpoint | 401 / login | 403 / access denied | 403 / access denied | allowed |
| Submit own draft event for review | 401 | 404 (not theirs) | own events only | any (via event management) |
| Approve / reject / request changes | 401 | 403 | 403 | allowed |
| Publish an event while approval is required | n/a | n/a | only when `APPROVED` | always |
| Announcements and maintenance changes | 401 | 403 | 403 | allowed |
| See announcements | no | by audience and own events | by audience | by audience |
| Download submission files | 401 | author, assigned judge | own events | allowed (signed, authorized each request) |
| Maintenance mode on: public writes | 503 | 503 | 503 | admin API, sign-in, sign-out, MFA always allowed |

Privacy: team pages show names (no emails), invitation addresses are masked, submission pages never include storage keys or hashes.

## 7. Safeguards and audit

Every change runs in a transaction with its audit row: `event.review_submitted|approved|rejected|changes_requested`, `announcement.created|updated|scheduled|published|unpublished|deleted`, `maintenance.mode_changed`, `admin.setting_changed`. Review decisions are atomic (`updateMany ... where review_status = SUBMITTED`), so a decision is made once. Maintenance cannot lock an administrator out: admin routes and sign-in stay open, and the switch is a database row an administrator can flip back in the UI. The cached state is 5 seconds per instance (so the effect can take up to 5 seconds to appear on another serverless instance).

## 8. Tests

- Unit and integration: `tests/admin-panel.test.ts` (20 tests: non-admin refusal of all 23 service calls for three roles, event-scoped admin grant, review lifecycle, reason validation, DB check, publish gate on and off, announcements lifecycle, audience and event visibility, maintenance enforcement and allowances, validation, audit, no secrets in the status view, real counts, privacy of team and submission views, judging progress, tie flags, certificate search).
- End to end: `e2e/admin-panel.spec.ts` (anonymous, participant and organizer refused on every page and endpoint including mutations; malformed ids and bodies; approval flow in the UI with reason prompts; announcement flow including audience visibility; 15 data pages at phone and desktop widths with WCAG 2.2 AA and no horizontal overflow, empty states, privacy of the HTML; existing user-status and role validation and audit), `e2e/admin-maintenance.spec.ts` (own Playwright project `chromium-global-state` because the switch is platform-wide: UI toggle with confirmation, validation, 503 with `Retry-After`, reads and sign-in still work, banner, turn off, audit, history, non-admin refused).
- Results of the final run: section 10.

## 9. Known limitations

- No team suspension and no score override (not supported by the existing business rules; deliberately not invented).
- Review is advisory unless "Event approval required" is switched on; editing an approved draft does not reset its approval.
- Organizers are not emailed about a decision; they see it on their event page. Announcements appear on the dashboard only (no outside notification service, no email).
- Reasons are collected with the browser prompt (the existing `ApiButton` convention), success feedback is an inline status line rather than a toast, and loading uses the existing skeleton fallbacks.
- Maintenance mode pauses writes, not reads; the cached state can lag up to 5 seconds per instance.
- Scheduled announcements need no job but only appear once their time passes and a page loads.
- The migration is not applied to production; real production behavior of the new pages is unverified until it is deployed.

## 10. Final commit and CI

Implementation commit: `56e499412c14c656ead98a185472964b1e5e17a6` on `feature/milestone-5-6-events-dashboards` (pushed to that branch only; no merge, no deployment). CI for that exact SHA: run 43974039201, `completed / success` (job `web`, every step green).

Local results before the push: `tsc` and `eslint` clean; `prisma validate` valid, 14 migrations up to date, no drift; Vitest 28 files, 525 tests passed; Playwright `npm run test:e2e` 145 passed, 7 skipped (6 existing skips plus the opt-in screenshot spec), 0 failed; `npm audit --omit=dev` 0 vulnerabilities; `next build` succeeded.

## Screenshots

`docs/reports/admin-panel/` (desktop 1440 px for every page; phone 390 px for overview, event review, submission, announcement and maintenance). Captured from the e2e server with seeded demonstration data (`ADMIN_SHOTS=1 npx playwright test --project=chromium e2e/admin-screenshots.spec.ts`).
