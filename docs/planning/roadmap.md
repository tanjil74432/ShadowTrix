# Roadmap

Each milestone ends with: tests passing, docs updated, completion criteria met. Nothing is marked done as a mockup.

| # | Milestone | Objective | Completion criteria | Status |
|---|---|---|---|---|
| 1 | Workspace & documentation | Folder structure, logo preserved, README, planning docs, reference analysis | Files exist; logo hash matches original | **Done** |
| 2 | Architecture & schema | Approve stack, finalize schema, scaffold app, CI, Docker Compose | Stack approved; migrations run on clean DB; checks pass locally | **Done locally** (CI workflow written, not yet run on GitHub: no remote/repo yet) |
| 3 | Design system & homepage | Tokens, base components, homepage incl. leadership preview | Lighthouse a11y ≥ 90; responsive at 4 breakpoints; reduced-motion respected | Planned |
| 4 | Authentication | Register, login/logout, verify email, reset, RBAC | Auth tests incl. abuse cases; role guards on all routes | Planned |
| 5 | Event discovery & registration | Explore, details, filters, register, capacity | Capacity race test passes; status logic unit-tested | Planned |
| 6 | Dashboards | Participant and organizer dashboards, announcements | E2E: create event → register → announce | Planned |
| 6a | Organization module | Our Team page, member profiles, admin CRUD, photo upload, terms, archive | Public pages render from DB; placeholder labeling; email privacy verified | Planned (can run parallel with 6) |
| 7 | Teams & submissions | Teams, invitations, project submission, deadlines | E2E team flow; deadline enforced server-side | Planned |
| 8 | Judging & certificates | Criteria, scoring, results, leaderboard, certificates + verification | Result calculation tests; certificate verify page | Planned |
| 9 | Admin & analytics | User/event/judge mgmt, analytics, settings, audit logs | Admin-only access tested; audit entries verified | Planned |
| 10 | Hardening & deployment | Security review, performance, backups, deploy docs | Dependency audit clean; load test baseline; runbook | Planned |

## Risks

- Scope is very large; sequence strictly by milestone and cut non-core features first.
- Logo is a black-background raster; navbar needs a transparent or SVG version (requested).
- No verified organization content yet; all team/leadership data stays placeholder.
