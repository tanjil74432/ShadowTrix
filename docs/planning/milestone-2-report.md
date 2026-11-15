# Milestone 2 Report — Architecture, Schema, Scaffold

Date: 2026-11-15

## Completed

1. Reviewed existing docs; rewrote technology decisions for the approved single Next.js architecture.
2. Reviewed the schema against all modules (Leadership Board, Core Team, Event Organizers, Participants, Judges, Certificates); implemented it in Prisma with a hand-written integrity migration.
3. Defined layers, module boundaries and API conventions; enforced the data-layer boundary with an ESLint rule.
4. Scaffolded Next.js 16 / React 19 / Tailwind 4 / TypeScript strict in `web/`.
5. Configured PostgreSQL 17 + Prisma 7.10.1 (driver adapter), migrations and an idempotent, people-free seed.
6. Docker Compose (Postgres, Mailpit) and a GitHub Actions workflow.
7. Logo derivatives (transparent, favicon.ico, app icons) built from the original artwork by a repeatable script. Original `1.png` hash unchanged.
8. Ran all checks.

## Check results (final state)

| Check | Result |
|---|---|
| Migrations on a fresh scratch database | 2 applied; seed OK; scratch DB dropped |
| `tsc --noEmit` (strict) | pass |
| ESLint | pass; layering rule verified to fire on a deliberate violation |
| Vitest | 17/17 pass (5 env-config, 12 database-integrity incl. specific constraint names) |
| `next build` | pass; `/api/health` dynamic |
| Runtime | `/api/health` 200 with DB up, 503 `degraded` with DB stopped, recovers; `/` 200 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (all) | 7 moderate, all in dev-time ESLint tooling (transitive `minimatch`) |

## Files added / changed

- Repo root: `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md` (updated), `.gitignore` (updated), `scripts/build-logo-assets.mjs`, `assets/branding/derived/*` (9 files). Removed the empty placeholder `frontend/` and `backend/` folders created in Milestone 1 (replaced by `web/`).
- `web/`: Next scaffold; `prisma/schema.prisma`, 2 migrations, `seed.ts`; `prisma.config.ts`; `src/server/{config,db,http,modules/health}`; `src/app/api/health/route.ts`; `src/app/{favicon.ico,icon.png,apple-icon.png}` (brand icons replacing scaffold defaults); `public/brand/logo-mark.png`; `tests/*`; `vitest.config.mts`; `eslint.config.mjs`; `.env.example`; `package.json` scripts; `README.md`.
- Docs: `technology-decisions.md`, `database-design.md`, `system-architecture.md` rewritten; `module-boundaries.md` added; `roadmap.md` updated; this report.

## Deviations and caveats

- **CI not yet run on GitHub.** The workflow mirrors the commands that passed locally, but there is no repository or remote yet, so it is unverified there.
- **No git repository exists yet** in `D:\ShadowTrix`; nothing has been committed.
- **Prisma pinned to 7.10.1.** npm `latest` for the CLI is an 8.0 release candidate; I avoided it.
- **Forkship audit:** the full audit has not reached this session (only the live-site fetch). Findings are carried by [reference-analysis.md](../design/reference-analysis.md); please re-share the audit before Milestone 3 so contrast/typography checks can be applied to the real findings.
- Dev ports: app 3010, Postgres 5433, Mailpit 1025/8025 (port 3000 is occupied by another local project).
- `AUTH_SECRET` in the local `.env` is a dev-only placeholder; production requires a real value (enforced).

## Remaining

- Milestone 3: design tokens, base components, homepage (incl. leadership preview and "About Us → Our Team" nav), Radix + Playwright/axe setup.
- Initialize git and push to a remote (needs your approval) so CI can run.
- Deferred schema items listed in [database-design.md](../architecture/database-design.md#known-gaps-deliberately-deferred).
