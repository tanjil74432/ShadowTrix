# Quality Assurance Report (Milestone 10)

All results below come from runs on this development machine with the real PostgreSQL and Mailpit services; each suite was run alone because the Vitest and Playwright suites share one database. Where something could not be done, it says so. CI was **not run**: nothing was committed or pushed, as instructed.

## Functional coverage

| Area | Where it is exercised |
|---|---|
| Registration, email confirmation, login, logout, reset, change password, MFA | Vitest `auth-*`, `hardening`; Playwright `auth.spec`, `hardening.spec`, `cross-browser.spec` (real emails through Mailpit) |
| User dashboards, settings | Playwright `events.spec`, `cross-browser.spec` |
| Event creation, editing, publishing, registration, waiting list, capacity | Vitest `events` (concurrency: 14 simultaneous registrations for 5 seats); Playwright `events.spec` |
| Individual and team workflows | Vitest `teams` (invitations, expiry, replay, size limit race, team capacity race); Playwright `teams-judging.spec` |
| Submissions, versions, deadline | Vitest `submissions`; Playwright `teams-judging.spec`, `cross-browser.spec` |
| File storage and private access | Vitest `submissions` (validation, storage, traversal), `admin` (photos); Playwright privacy tests |
| Judging, results, ties, publication gate | Vitest `judging` (hand-computed scores, concurrency, completeness); Playwright full journey |
| Certificates (issue, PDF, verify, revoke) | Vitest `judging`; Playwright journey |
| Administration: users, events, organizations, audit, settings | Vitest `admin` (18 tests); Playwright `admin.spec` |
| Organization and leadership, public team page, photos | Vitest `admin`; Playwright `admin.spec` (draft, placeholder, verified, published, contact privacy, archive, former members) |
| Analytics | Vitest `admin` (exact figures for an isolated date range, range validation); Playwright `admin.spec` |
| Announcements | **Not implemented** (never built; listed in the roadmap as not started) |

## Test totals (final run of this package)

| Check | Result |
|---|---|
| TypeScript typecheck, ESLint | clean |
| Vitest (unit + database integration + architecture + secrets) | **391 of 391 passed**, 18 files |
| Playwright, full suite (project `chromium`, installed Microsoft Edge) | **116 passed, 1 skipped** (an earlier complete run had 2 timeouts at the previous 10 s assertion limit under load; both passed alone; the limit is now 15 s and the final run is clean) |
| Playwright, cross-browser journeys (6 projects) | **29 passed, 1 skipped** (see below) |
| Fresh database migration and drift check | **11 migrations apply, drift exit 0, 25 CHECK constraints, 2 triggers** |
| Production build | passes |
| `npm audit --omit=dev` | 0 vulnerabilities |
| GitHub CI | **not run** (no push) |

## Accessibility (WCAG 2.2 AA)

Automated with axe-core (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) at 360 px and 1440 px on every page of the application, in normal and form-error states, including all administration, judge, organizer, team, submission, results and certificate pages. Layout overflow is checked at the same time. Keyboard: skip link focus, mobile menu dialog (focus trap, Escape, focus return), reveal-password toggle and every form submit button are exercised by Playwright. Form errors are announced (`role=alert`, `aria-invalid`, messages tied to fields), verified in the cross-browser run. Charts have their numbers as text and a hidden table.

**What this does not prove:** automated checks find only part of accessibility problems. **No manual screen-reader review (NVDA, JAWS, VoiceOver) and no manual keyboard-only walk-through of every page was done**; it remains required before launch (backlog A5).

## Browsers and devices

`npm run test:e2e:cross` runs five core journeys (home/events/layout/skip link/CSP/axe, two-step signup with real email, login/settings/logout, project submission with file upload and private download, form error accessibility) in six projects:

| Project | Engine | Viewport | Result |
|---|---|---|---|
| x-chromium-desktop | Microsoft Edge (Chromium) | 1280 x 720 | pass |
| x-firefox-desktop | Firefox (Playwright build) | 1280 x 720 | pass, one skip |
| x-webkit-desktop | WebKit (Safari engine) | 1280 x 720 | pass |
| x-webkit-tablet | WebKit, iPad (gen 7) | 810 x 1080 touch | pass |
| x-webkit-phone | WebKit, iPhone 13 | 390 x 844 touch | pass |
| x-chromium-phone | Chromium, Pixel 7 | 412 x 915 touch | pass |

Findings: (1) **Skipped in Firefox:** running axe on the login page in its error state crashes Playwright's Firefox build (reproduced in isolation, also without the contrast rule); the same state is axe-clean in Chromium and WebKit, and axe is clean in Firefox on every other page. The cause was not isolated (tooling or browser, not shown to be the application). (2) WebKit reports cancelled prefetch requests as a script error ("access control checks"); this is browser behavior when navigating away and is filtered in the test. (3) WebKit does not Tab to links by default (a Safari setting), so the skip-link test focuses it directly there. (4) A contrast failure caught mid-animation was a test timing issue; the other accessibility suites already use reduced motion.

**Not done (honestly):** no real phone or tablet, no real Safari on macOS or iOS, no older browser versions, no assistive-technology testing on devices. Playwright's WebKit is an engine build, not Apple's Safari. These need to be done manually before launch (backlog A3, A4).

## Database, migration and backup safety

- Fresh database: 11 migrations apply; `prisma migrate diff` reports no drift; all hand-written constraints, triggers and partial indexes are present (a database test asserts the specific constraint that fires for each rule; the administration tests found and closed one gap, see the security review).
- Backup and restore were **run**: a database with 200 users, 20 events, 600 registrations and 500 audit rows was dumped with `scripts/ops/backup.sh`, restored into a new empty database with `scripts/ops/restore.sh`: **identical row counts in all 35 tables**, the same 25 CHECK constraints, 2 triggers, 106 indexes and 11 recorded migrations, `migrate status` up to date and zero drift. The restore script **refused** a non-empty target (exit 3) and a tampered dump (exit 2, checksum mismatch).
- No destructive operation touched the development data; all scratch databases (`st_verify`, `perf_verify`, `br_*`) were dropped.

## Performance

See [performance.md](performance.md): large-dataset query plans, index justification (one index was added with evidence and one removed for lack of it), HTTP response times, bundle sizes.

## Environment incident (disclosed)

While trying to build the container image, the development machine's system drive filled up. Docker Desktop stopped and the development database and Mailpit containers went down for a few minutes. I deleted only files I had created (two old fresh-clone verification copies in the assistant's temp folder, about 1.7 GB, plus Docker build cache that the failed build produced) and restarted Docker Desktop; the database came back intact (11 migrations, data unchanged). The image build therefore did not finish (see the deployment guide's verification table). The drive is still nearly full and Docker may fail again: please free disk space on the system drive.

## Known limitations

No CI run on this code, no independent security review, no manual accessibility or real-device testing, no load or stress test, no real HTTPS host test, container image not run, announcements not implemented, S3 storage not implemented, no upload malware scanning, UTC-only event times, non-Latin characters in certificate PDFs print as `?`, Playwright's Firefox crashes under axe on one page state.
