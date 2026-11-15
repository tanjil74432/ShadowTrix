# Roadmap

Each milestone ends with: tests passing, docs updated, completion criteria met. Nothing is marked done as a mockup.

| # | Milestone | Objective | Completion criteria | Status |
|---|---|---|---|---|
| 1 | Workspace & documentation | Folder structure, logo preserved, README, planning docs, reference analysis | Files exist; logo hash matches original | **Done** (on `main`) |
| 2 | Architecture & schema | Approve stack, finalize schema, scaffold app, CI, Docker Compose | Stack approved; migrations run on clean DB; checks pass | **Done** (on `main` and `develop`) |
| 3 | Design system & homepage | Tokens, base components, homepage incl. leadership preview | Axe clean at 4 breakpoints; reduced-motion respected; contrast tested; CI green | **Done.** CI green on GitHub. Branch `feature/milestone-3-design-system`; pull request into `develop` prepared, awaiting review and merge |
| 4 | Authentication & authorization | Register, login/logout, verify email, reset, sessions, RBAC, rate limiting | Auth tests incl. abuse cases; role guards on all routes and APIs | **Done locally** on `feature/milestone-4-authentication` (stacked on M3). 218 unit/integration and 66 e2e tests pass in a fresh clone **and on GitHub Actions** (green on `e2ce622`); 12-character password policy applied. Awaiting review |
| 5 | Event discovery & registration | Explore, details, filters, register, capacity | Capacity race test passes; status logic unit-tested | Not started (awaiting approval) |
| 6 | Dashboards | Participant and organizer dashboards, announcements | E2E: create event → register → announce | Planned |
| 6a | Organization module | Our Team page, member profiles, admin CRUD, photo upload, terms, archive | Public pages render from DB; placeholder labeling; email privacy verified | Planned (can run parallel with 6) |
| 7 | Teams & submissions | Teams, invitations, project submission, deadlines | E2E team flow; deadline enforced server-side | Planned |
| 8 | Judging & certificates | Criteria, scoring, results, leaderboard, certificates + verification | Result calculation tests; certificate verify page | Planned |
| 9 | Admin & analytics | User/event/judge mgmt UI, analytics, settings, audit-log viewer | Admin-only access tested; audit entries verified | Planned (the user-management API already exists) |
| 10 | Hardening & deployment | Security review, CSP, performance, backups, scheduled cleanup, deploy docs | Independent security review; dependency audit clean; load test baseline; runbook | Planned |

## Carried forward from Milestone 4 (see [milestone-4-report.md](milestone-4-report.md))

- Change-password screen for signed-in users, email change, multi-factor authentication, "sign out other devices".
- Scheduled cleanup of expired sessions, tokens, rate-limit rows and unverified accounts.
- Content-Security-Policy; periodic rotation of live session tokens.
- Admin management interface (currently API plus a read-only user list).

## Risks

- Scope is very large; sequence strictly by milestone and cut non-core features first.
- No verified organization content yet; all team/leadership data stays placeholder.
- Authentication has been self-reviewed and heavily tested but not independently audited; obtain an external review before real users' data is handled.
- Stacked branches (M4 on M3): merge M3 into `develop` first, then retarget the M4 pull request.
