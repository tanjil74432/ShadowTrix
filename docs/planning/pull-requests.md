# Prepared Pull Requests

**Neither pull request has been opened or merged.** The GitHub CLI is not installed here and credentials are never handled by the assistant, so open each pull request in the browser with the links below and paste the title and description. Merging into `develop` or `main` needs the owner's explicit approval. Branch-protection settings cannot be read without authentication and are unknown.

## Relationship between the two pull requests

```text
main = develop (ab43094, Milestone 2)
   └── feature/milestone-3-design-system        b814299   <- PR 1 (into develop)
          └── feature/milestone-4-authentication  (tip changes; see Review status) <- PR 2 (stacked on PR 1)
```

- Milestone 4 was built on top of Milestone 3 (it needs the design system and the header). Branch 4 contains every Milestone 3 commit, verified with `git merge-base --is-ancestor`.
- **Merge order: PR 1 first, then PR 2.** Until PR 1 is merged, PR 2's diff against `develop` also shows all Milestone 3 changes (180 files). After PR 1 merges, GitHub reduces PR 2 to Milestone 4 only (about 105 files), or retarget it explicitly.
- Neither is merged. PR 2 must stay unmerged until separately approved.

## Review status (what was actually checked)

| Check | PR 1 (M3) | PR 2 (M4) |
|---|---|---|
| Full diff reviewed against `develop` | yes: 89 files, +4,479 / −137, 5 commits | yes: 180 files vs `develop`, 105 files vs M3, +5,658 / −101 vs M3 |
| `.env`, secrets, test data, build output, generated client, dumps, files over 1 MB | none found | none found (the only secret-pattern match is a deliberate fake placeholder inside a unit test) |
| Existing migrations modified or deleted | none (1 additive migration) | none (3 additive migrations vs `develop`; the third is the signup redesign) |
| Fresh-database migration, then schema drift check | passes; drift exit 0 (CI) | passes; drift exit 0 (fresh clone and CI) |
| Hand-written protections present after a fresh migrate | 16 CHECK constraints, 1 trigger, 7 custom indexes (verified) | 20 CHECK constraints, 1 trigger, 8 custom indexes, `sessions` and `rate_limits` tables, nullable `password_hash` (verified on a fresh database after the signup redesign) |
| CI on GitHub | success on `b814299` | success on `e2ce622`: 21 of 21 steps, "66 passed, 1 skipped" |
| Re-run locally in a fresh clone for this review | n/a (verified in the earlier clone and on GitHub) | typecheck, lint, 218 tests, build, 66 e2e, audit: all pass on `62de2ea`; CI then re-verified the final `e2ce622` |

**Ready for review:** yes, both. **Ready to merge:** only after your review and explicit approval; PR 1 first.

---

## PR 1: Milestone 3 into `develop`

Open: https://github.com/tanjil74432/ShadowTrix/compare/develop...feature/milestone-3-design-system?expand=1

**Title:** Milestone 3: design system, base components and homepage

**Description**

Design system (contrast-tested tokens), base components and the homepage, built to address the Forkship audit findings. All events and people shown are clearly labelled sample or placeholder content.

*Implementation summary*
- Tokens for colour, type, spacing, radius, shadow and motion; contrast of every pair is verified by a unit test that parses the CSS
- Navbar (Radix dropdown and dialog menus), footer, buttons, badges, event card, five-phase event timeline, profile card, form fields, loading and empty states
- Homepage: hero (one H1, two actions), featured events, categories and technology domains, how it works, organization intro, leadership preview, community, previous events, call to action
- Honest "not available yet" pages (noindex), so no link is broken; Open Graph and Twitter metadata, JSON-LD, robots, sitemap, manifest

*Migration notes*
- One additive migration (`20261115100758_event_timeline_dates`): judging period and result-announcement dates on events, with three ordering CHECK constraints. No existing migration is touched. The index `org_members_public_idx` is now declared in the Prisma schema, so Prisma no longer proposes dropping it.
- Verified on a fresh database: 3 migrations apply, no schema drift, 16 CHECK constraints, 1 trigger and 7 hand-written indexes present.

*CI changes*
- `typecheck` runs `next typegen` first (it failed on any fresh checkout); `prisma generate` works without a `.env`; CI runs on `develop` and `feature/**`; Playwright reports failures as GitHub annotations; one flaky image test fixed.

*Testing evidence*
- Typecheck, lint, 44 unit and database tests, production build, 24 Playwright tests (4 breakpoints, axe WCAG 2.2 AA, keyboard, reduced motion, SEO, link integrity). **GitHub Actions: success on `b814299`.**

*Known limitations*
- Firefox, Safari, real devices, manual screen-reader review and Lighthouse scores not done. Sample content is replaced by real data in Milestones 5 and 6a.

Reports: `docs/planning/milestone-3-report.md` (with integration addendum), `docs/design/design-system.md`.

---

## PR 2: Milestone 4 into `develop` (open after PR 1 is merged, or open now as a stacked PR)

Open: https://github.com/tanjil74432/ShadowTrix/compare/develop...feature/milestone-4-authentication?expand=1

**Title:** Milestone 4: authentication, sessions and role-based access control

**Description**

Registration, email confirmation, login and logout, password reset, server-side sessions, role-based access control for pages and APIs, an administrator user API, rate limiting and CSRF protection. Design and threat model: `docs/architecture/authentication.md`. API: `docs/api/auth-and-admin-api.md`. Remaining security work: `docs/planning/security-backlog.md`.

*Implementation summary*
- **Two-step signup (closes the pre-registration account takeover):** registration takes only an email and creates a pending account with no password; the mailbox owner opens the emailed single-use link and chooses name and password on that page (`POST /auth/complete-registration`); a CHECK constraint forbids a verified account without a password
- Argon2id (64 MiB, 3 passes); random 256-bit tokens stored only as SHA-256; single-use tokens safe under concurrent requests; sessions revoked on logout, password reset and suspension
- Identical responses and equal cost for known and unknown accounts (register, login, resend, forgot-password)
- Postgres-backed rate limiting; Origin-based CSRF; open-redirect protection; log redaction; audit trail
- Role/permission matrix as pure functions; admin safeguards (no self-demotion, last admin, concurrent demotion)
- Email links only open a page; a button press consumes the token, so mail scanners cannot burn it
- **Password policy: 12-character minimum** (owner decision), from one shared constant used by the server and the form hints; applies to registration and reset
- `npm run admin:grant -- <email>` bootstraps the first administrator. **No administrator has been granted and no default credentials exist.** Prerequisites: the account must already exist, be email-verified and active.
- **Admin MFA is optional by policy** (never mandatory, must not block admins who have not enrolled); it is not implemented yet.

*Migration notes*
- Also `20261115180000_signup_password_after_verification`: `users.password_hash` becomes nullable and CHECK `users_verified_requires_password_chk` is added (additive; no data change; safe on an empty or populated table because no existing verified user can have a NULL hash).
- One additive migration (`20261115121032_auth_sessions_and_rate_limits`): `sessions`, `rate_limits`, three CHECK constraints and a partial unique index (a user has at most one live verification token and one live reset token). The SQL was reviewed and extended before it was applied; no existing migration is touched. Fresh-database apply and drift check pass. The Prisma client is generated as CommonJS so Playwright can load it.

*Environment and deployment assumptions* (`docs/architecture/environment-variables.md`)
- `AUTH_SECRET` is required (32+ random characters; rejected in production if it looks like a placeholder). `APP_URL` must be `https://` in production and identical at build and run time. `TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-For`. Hosting is still undecided.

*Testing evidence*
- 229 unit and database-backed integration tests (RBAC matrix, tokens, sessions, rate limits, admin safeguards, concurrency, password policy boundary 11 rejected / 12 accepted) and 71 Playwright tests (1 skipped: opt-in screenshots) (real SMTP via Mailpit, real PostgreSQL: full journey, reset, session expiry, role matrix on pages and APIs, CSRF, enumeration, rate limiting, WCAG 2.2 AA on account pages). Passed in a fresh clone against a fresh database and **on GitHub Actions (see the CI result recorded in the final report for the current tip)**. 0 production dependency vulnerabilities.

*Known limitations* (see the backlog; none is marked done unless implemented and tested)
- No change-password flow, no MFA, no scheduled cleanup, no CSP, no periodic rotation of live session tokens (see the backlog; the pre-registration takeover is now closed by the two-step signup); self-reviewed only, so obtain an independent security review before real user data.

*Needs owner decisions:* see the final section of `docs/planning/security-backlog.md` and the Milestone 4 report.
