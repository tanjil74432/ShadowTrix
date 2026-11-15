# Milestones 5 and 6 and Authentication Hardening: Report

Branch `feature/milestone-5-6-events-dashboards` (from `develop` at `5ad058b`). Combined Work Package 02. Milestone boundaries are kept in the documentation even though the work was done together. **Not merged. Nothing was granted to any account. Milestones 7 and 8 were not started.**

## 1. Milestone 5: event management (done locally, awaiting review)

| Requirement | Result |
|---|---|
| Public event listing | `/events`, published events only, ordered by start date, paginated |
| Event details | `/events/{slug}` with description, eligibility, five-phase timeline, places, hosts; cancelled events say so |
| Categories and filtering, search | All seven required types plus Other; plain GET form (works without JavaScript), case-insensitive title/summary search, parameterized |
| Draft and published states | `DRAFT`, `PUBLISHED`, `CANCELLED`, `ARCHIVED` with a tested transition table |
| Create, edit, publish for organizers | Forms and API; drafts invisible to everyone but the people who manage them |
| Registration opening and closing | Dates plus a manual close/reopen switch; reasons returned as codes |
| Capacity and limits | Row-locked transactions; waiting list; promotion on cancellation or capacity increase; capacity cannot drop below the confirmed count |
| Register and cancel | Idempotent register, own-registration cancel, re-register reuses the row |
| Status and lifecycle | Single derived status (opens soon, open, closed, full, live, ended, cancelled) |
| Hosting organizations | The platform operator organization is attached as host; shown on the event |
| Organizer ownership and permissions | `canManageEvent`: organizers manage only events they organize; administrators all; event-scoped grants one event |
| Validation and server-side authorization | Zod (timeline rules mirror database CHECKs); unknown fields (status, slug, owner) ignored; authorization before body validation on create |

Not in this release (stated, not hidden): team registration (events are individual-mode), cover image upload, schedule items, event announcements, emails on cancellation or promotion, times in zones other than UTC, individual events in the sitemap.

## 2. Milestone 6: dashboards (done locally, awaiting review)

Participant: overview, registered events with status (upcoming, past, cancelled), upcoming deadlines, account settings (profile, change password). Organizer: overview with basic analytics, managed events table, create/edit, publishing controls, registration counts and participant list (organizers of that event only, audited). Role-aware navigation, empty, loading (Suspense skeletons) and error states, responsive layouts, WCAG 2.2 AA axe checks at 360 and 1440 px. **Announcements** (listed in the roadmap for M6) are not built. **Submission and judging status** placeholders were not added because nothing real exists to show; they arrive with Milestones 7 and 8.

## 3. Authentication hardening

| Item | Status |
|---|---|
| Content-Security-Policy | **Partly done.** Restrictive same-origin policy sent and tested (external scripts blocked, no violations on real flows). Still allows `'unsafe-inline'`; a nonce/hash policy is open |
| Expired session and token cleanup, stale unverified accounts | **Job done and tested** (`npm run maintenance:cleanup`, protected endpoint). **Not scheduled**: needs a scheduler (hosting decision) |
| Session lifecycle and rotation | **Partly done.** Revocation and fresh tokens on password change and on role changes. **Time-based rotation not built** (cookies cannot be set while rendering); lifetimes unchanged |
| Change-password | **Done and tested** |
| Optional administrator MFA | **Done and tested**, optional and never blocking; TOTP plus recovery codes; break-glass `admin:mfa-reset` |
| Signup (email verified before password) | Preserved; regression tests pass |

## 4. Database and migrations (additive only; no existing migration changed)

`20261116090000_events_registrations_integrity` (2 CHECKs, 3 indexes) and `20261116110000_admin_mfa` (`user_mfa`, `mfa_recovery_codes`). Fresh database: 7 migrations apply, **no drift**, **22 CHECK constraints, 1 trigger**, all hand-written indexes present.

## 5. API added

See [../api/events-and-dashboards-api.md](../api/events-and-dashboards-api.md) and the additions in [../api/auth-and-admin-api.md](../api/auth-and-admin-api.md): events (list, by slug, create, read, update, status, registration window), registrations (list for organizers, register, cancel), `me/registrations`, `me/profile`, `auth/change-password`, `auth/mfa/{enroll,confirm,disable}`, `internal/cleanup`. Removed earlier: `auth/verify-email` (replaced by `complete-registration`).

## 6. Pages and components added

Pages: `/events`, `/events/[slug]`, `/dashboard` (rewritten), `/dashboard/settings`, `/organizer` (rewritten), `/organizer/events/new`, `/organizer/events/[id]`. Components: event filters, registration panel, area navigation, registration row, profile form, change-password form, MFA panel, organizer event form, status controls. The navbar's active-link logic now streams (needed for dynamic routes).

## 7. Tests actually executed (this branch, locally, one run at a time)

| Check | Result |
|---|---|
| Typecheck, ESLint | clean |
| Unit and database integration (Vitest) | **282 of 282 passed**: includes 31 event tests (lifecycle, permissions, ownership, 14 simultaneous registrations for 5 seats, simultaneous cancel/register, waitlist order, privacy) and 22 hardening tests (RFC 6238 vectors, MFA, replay, change-password, role-change revocation, cleanup safety) |
| Playwright e2e | **93 passed, 1 skipped** (opt-in screenshots): includes 16 event/dashboard tests, 6 hardening tests, signup, RBAC and accessibility regression |
| Fresh database migration, drift | 7 migrations, drift exit 0, 22 CHECKs, 1 trigger |
| Production build | passes (run by the e2e server) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| GitHub CI | see the final report for the result on the pushed commit |

## 8. Security findings during this work, and fixes

- A role change left an old session alive with the new role set: **fixed**, such changes now end the target's sessions.
- Test cleanup wiped shared rate-limit counters while other test files were running (a flaky brute-force test): **fixed**.
- Concurrent test runs share one database and can interfere; tests must run one suite at a time (documented here).

## 9. Known limitations

See [../architecture/events.md](../architecture/events.md) and the backlog. Notably: UTC-only times, `200` not-found view for hidden events (marked `noindex`), CSP allows inline scripts, no time-based session rotation, cleanup is not scheduled, MFA is TOTP-only and administrators-only, self-reviewed only.

## 10. Remaining for Milestones 7 and 8

Teams and invitations, team-event registration, project submissions with file storage and deadlines (M7); judging criteria, scoring, results, leaderboard, certificates and verification (M8); announcements; emails for event changes; organization module (M6a). Hosting decision (scheduler, proxy, HTTPS) and the independent security review remain open.
