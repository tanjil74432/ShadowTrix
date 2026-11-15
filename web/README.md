# ShadowTrix web app

Next.js (App Router) + TypeScript + Tailwind + Prisma/PostgreSQL. See the repository [README](../README.md) and [docs](../docs/).

## Run locally

```bash
# 1. From the repository root: start PostgreSQL (host port 5433) and Mailpit (UI http://localhost:8025)
docker compose up -d

# 2. In web/
cp .env.example .env          # then set AUTH_SECRET: 32+ random characters (required; see .env.example)
npm install                   # also generates the Prisma client
npm run db:deploy             # apply migrations
npm run db:seed               # reference data only (operator org, units, designations)
npm run dev                   # http://localhost:3010
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3010 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (includes the data-layer boundary rule) |
| `npm test` | Vitest: env validation + database integrity tests (needs the database running and migrated) |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:deploy` | Apply existing migrations (CI/production) |
| `npm run db:seed` | Idempotent reference-data seed |
| `npm run logo:build` | Rebuild transparent logo + favicon derivatives from `assets/branding/1.png` |

## Layout

```text
prisma/            schema, migrations (incl. hand-written integrity checks), seed
src/app/           pages and thin route handlers
src/server/        config, db, http helpers, modules/<module>/ (business logic)
src/generated/     Prisma client (git-ignored, generated)
tests/             Vitest tests
```

Next.js 16 note: `cacheComponents` is enabled. Read request-time data (cookies, database) inside `<Suspense>` or a `use cache` boundary; the build fails otherwise. Bundled docs: `node_modules/next/dist/docs/`.
