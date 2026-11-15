# Technology Decisions

Status: **Approved** (2026-11-15). Supersedes the earlier proposal that recommended a separate NestJS backend.

Criteria: stable, open-source, well-supported, portable, no mandatory paid services, minimal moving parts.

## Approved stack

| Concern | Choice (installed version) | Why |
|---|---|---|
| Architecture | Single Next.js full-stack app, layered (see [module-boundaries.md](module-boundaries.md)) | One deployable, simplest to run; layering keeps a future NestJS extraction cheap |
| Framework | Next.js 16.4 (App Router) + React 19, `cacheComponents` on | SSR/SSG for SEO; request-time data must be inside `<Suspense>` or `use cache` (enforced by the build) |
| Language | TypeScript 5.9, `strict: true` | Strong typing requirement |
| Styling | Tailwind CSS 4 | Token-driven monochrome design system |
| Components | Radix UI primitives (added in Milestone 3 when the first interactive component needs them) | Accessible behavior without a heavy kit |
| Database | PostgreSQL 17 | Relational integrity, transactions, partial indexes, CHECK constraints |
| ORM | Prisma 7.10.1 + `@prisma/adapter-pg` | Typed client, versioned migrations. Pinned to stable 7.x; npm's `latest` CLI tag currently points to an 8.0 release candidate, which we deliberately avoid |
| Validation | Zod 4 | One schema language for env config, API input, forms |
| Auth | Self-managed (Milestone 4): Argon2id, hashed single-use tokens, httpOnly cookie sessions, RBAC | No third-party dependency or cost |
| Email | Nodemailer 10 over SMTP; Mailpit locally | Provider-agnostic |
| Certificates | pdf-lib 1.17 | Pure JS, no external service |
| Storage | Driver switch: `local` or `s3` (any S3-compatible), via env | Portable; storage interface lands with file uploads (Milestone 7) |
| Tests | Vitest 5 (unit + DB integration); Playwright + axe added with UI milestones | |
| CI | GitHub Actions (typecheck, lint, tests, build, audit) | Config is plain YAML; commands are ordinary npm scripts, so they run on any CI |
| Local infra | Docker Compose: Postgres + Mailpit | One-command setup, host-agnostic |
| Package manager | npm | Already present; single app so no workspace tooling needed |

## Portability rules

- No hosting-provider SDKs. All deployment-specific values (database, SMTP, storage, URLs) come from environment variables, validated at startup by `src/server/config/env.ts`.
- `docker-compose.yml` is for local development only. A production container image and deployment guide are Milestone 10 work.
- Dev ports: app 3010, Postgres 5433 (host), Mailpit 1025/8025 (chosen to avoid clashing with other local projects).

## Extensibility: future NestJS extraction

- All business logic lives in `src/server/modules/<module>/` and imports nothing from `next/*` or React. Route handlers only parse input, call a service, and format the response.
- An ESLint rule forbids `src/app` and `src/components` from importing the database layer, so data access cannot leak into the UI.
- Extracting a module later means moving its folder to a Nest module and keeping the same REST contract (`/api/v1/*`).

## Organizations vs. multi-tenancy

ShadowTrix is a single-organization platform operated by Team EU Shadow. Multi-tenancy is **not** implemented. To keep collaboration possible later, events can record hosts (`organizations`, `event_hosts` with HOST / CO_HOST / PARTNER). There is no per-tenant data isolation and exactly one operator organization is enforced by a database index.

## Known trade-offs and notes

- Self-managed auth carries security responsibility; mitigations are listed in [system-architecture.md](system-architecture.md).
- npm blocks some dependency install scripts by default (`allowScripts`). Prisma 7 does not need its engine postinstall for our setup, and everything works; revisit if a native dependency fails to build.
- `npm audit` currently reports moderate findings only in dev-time ESLint tooling (transitive `minimatch`); production dependencies report 0 vulnerabilities and CI blocks on high+ production findings.
