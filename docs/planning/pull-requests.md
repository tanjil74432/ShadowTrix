# Prepared Pull Requests

No pull request has been opened: the GitHub CLI is not installed here and credentials are never handled by the assistant. Open them in the browser using the links below and paste the descriptions. Do not merge into `main` or `develop` without review.

Merge order: **M3 first, then M4.** Milestone 4 is stacked on Milestone 3 (it contains the M3 commits), so after M3 merges, change the M4 pull request's base to `develop` and the diff reduces to M4 only.

---

## PR 1: Milestone 3 into `develop`

Open: https://github.com/tanjil74432/ShadowTrix/compare/develop...feature/milestone-3-design-system?expand=1

**Title:** Milestone 3: design system, base components and homepage

**Description**

Design system (tokens, contrast-tested), base components, and the homepage, built to address the Forkship audit findings. All events and people shown are labelled sample or placeholder content.

- Tokens for colour, type, spacing, radius, shadow and motion; contrast of every pair verified by a unit test that parses the CSS
- Navbar (Radix dropdown and dialog menus), footer, buttons, badges, event card, five-phase event timeline, profile card, forms, loading and empty states
- Homepage: hero (one H1, two actions), featured events, categories and technology domains, how it works, organization intro, leadership preview, community, previous events, call to action
- Honest "not available yet" pages (noindex) so no link is broken; Open Graph and Twitter metadata, JSON-LD, robots, sitemap, manifest
- Additive database change: judging period and result-announcement dates on events, with ordering CHECK constraints and tests
- CI fixes: typecheck works on a fresh checkout, `npm install` works without a `.env`, CI runs on feature branches, e2e failures reported as annotations, one flaky image test fixed

Verification: typecheck, lint, unit and database tests, production build, 24 Playwright tests (4 breakpoints, axe WCAG 2.2 AA, keyboard, reduced motion, SEO, link integrity) all pass locally in a fresh clone **and on GitHub Actions** (run on `b814299`).

Reports: `docs/planning/milestone-3-report.md` (including the integration addendum), `docs/design/design-system.md`.

Not covered: Firefox, Safari, real devices, manual screen-reader testing, Lighthouse.

---

## PR 2: Milestone 4 into `develop` (after PR 1 merges)

Open: https://github.com/tanjil74432/ShadowTrix/compare/develop...feature/milestone-4-authentication?expand=1

**Title:** Milestone 4: authentication, sessions and role-based access control

**Description**

Registration, email confirmation, login/logout, password reset, server-side sessions, role-based access control for pages and APIs, an administrator user API, rate limiting and CSRF protection. Design and threat model: `docs/architecture/authentication.md`. API: `docs/api/auth-and-admin-api.md`.

Highlights
- Argon2id (64 MiB, 3 passes); random 256-bit tokens stored only as SHA-256; single-use tokens safe under concurrent requests
- Server-side sessions with absolute and idle expiry; revoked on logout, password reset and suspension
- Identical responses and equalised cost for known and unknown accounts (register, login, resend, forgot-password)
- Postgres-backed rate limiting; Origin-based CSRF check; open-redirect protection; log redaction; audit trail
- Role/permission matrix as pure functions; admin safeguards (no self-demotion, last admin, concurrent demotion)
- Email links only open a page; a button press consumes the token, so mail scanners cannot burn it
- `npm run admin:grant -- <email>` bootstraps the first administrator (no default credentials exist)
- Migration adds `sessions` and `rate_limits` plus CHECK constraints and a partial unique index; existing migrations untouched

Verification: 213 unit and database-backed integration tests and 63 Playwright tests (real SMTP via Mailpit, real PostgreSQL) pass in a fresh clone against a fresh database; no schema drift; 0 production dependency vulnerabilities. GitHub Actions result: see `docs/planning/milestone-4-report.md`.

Known limitations (documented): no change-password screen for signed-in users, no MFA, no scheduled cleanup, no CSP yet, no periodic rotation of live session tokens, self-reviewed only (get an independent review before real user data).

Needs a decision: see "Approvals needed" in the Milestone 4 report.
