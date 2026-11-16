# Deployment workflow: GitHub to Vercel

Project facts (checked 2026-11-17): GitHub repository `tanjil74432/ShadowTrix` is **public**, default branch `main`. Vercel project `shadow-trix`, application root `web`. Database Neon (13 migrations applied), files Backblaze B2 (private bucket), mail Gmail SMTP.

## The workflow

```
Local change -> typecheck, lint, tests -> commit -> push a branch -> GitHub Actions CI (job "web")
      -> Vercel PREVIEW deployment of that branch  -> open a pull request
      -> CI green + review -> merge to main -> Vercel PRODUCTION deployment (automatic)
      -> run the smoke checks below
```

Nothing deploys to production except a merge to `main`. Branch pushes and pull requests only create Preview deployments.

## One-time setup (owner actions in the dashboards)

**Vercel** (Project `shadow-trix` > Settings)
1. Git: connected repository `tanjil74432/ShadowTrix`; **Production Branch `main`**. Do not create another project or repository.
2. Build and Deployment: **Root Directory `web`**, Framework Preset **Next.js** (leave build and install commands at their defaults), **Node.js Version 24.x** (the code also pins `engines.node = 24.x`; Vercel's default for new projects is 26.x, which has not been tested with ShadowTrix).
3. Environment Variables: see the table below. Production scope only for secrets.
4. Functions region: `iad1` is set in `web/vercel.json` (closest to Neon us-east-2). Cron: one daily job calls `/api/v1/internal/cleanup`.

**GitHub** (Settings > Branches > Branch protection rule for `main`; free for public repositories)
1. Require a pull request before merging.
2. Require status checks to pass: select the `web` job of the CI workflow. Require branches to be up to date.
3. Block force pushes and deletions.
This is what makes CI protect production: code reaches `main` only after CI passes, and only `main` deploys to production. (On Vercel Hobby there is no setting that makes a deployment wait for GitHub Actions, so the branch rule is the gate.)

## Environment variables (names only; never commit values)

| Variable | Needed at | Production | Preview |
|---|---|---|---|
| `APP_URL` | build and runtime (baked into metadata) | exact `https://<production domain>` | leave unset (Vercel exposes the preview URL; see below) |
| `STORAGE_DRIVER`, `S3_ENDPOINT` | **build** and runtime (the CSP is built from them) | `s3`, Backblaze endpoint | do not set |
| `ENABLE_STYLEGUIDE` | build | `false` | `false` |
| `DATABASE_URL` | runtime | Neon **pooled** URL | **do not set the production URL** |
| `AUTH_SECRET`, `CRON_SECRET` | runtime | new random 48-byte values | different values, or unset |
| `TRUST_PROXY` | runtime | `true` | `true` |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | runtime | Backblaze values | do not set |
| `PENDING_UPLOAD_TTL_MINUTES` | runtime | `120` | optional |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | runtime | Gmail SMTP and an App Password | do not set |

**Preview scope and a public repository.** Anyone can open a pull request against a public repository, and Preview deployments run that branch's code. Never put production credentials in the Preview scope. Without database credentials a preview shows the public pages only. A safe optional upgrade is a separate Neon branch for previews. The values for Production can be imported from the git-ignored `web/.env.production.local` (built by `scripts/prod-env.mts`).

## Database migrations are not run by Vercel

Vercel builds the app; it never touches the database schema. When a change adds a migration:
1. Make it additive and backward compatible (the old code must still work against the new schema).
2. Apply it **before** merging, with `node scripts/neon.mjs check`, then `deploy`, then `verify` (guarded script, direct connection, refuses unknown databases).
3. Then merge and let Vercel deploy the code that uses it.
Destructive changes are split over two releases (code stops using the column first).

## After every production deployment (smoke checks)

`GET /api/health` returns `{"status":"ok","database":"up"}`; the home page, `/events`, `/login` and `/register` load; `/api/v1/internal/cleanup` without a secret returns 401; the response headers include `Strict-Transport-Security` and a `Content-Security-Policy`. Vercel logs show no errors. Check the first scheduled cleanup run in the Vercel logs.

## Rollback

Vercel dashboard > Deployments > promote or redeploy the previous successful production deployment (availability of instant rollback on Hobby is unverified; redeploying the previous commit always works). Migrations are additive, so the older code keeps working.

## Vercel CI (the `vercel/ci@setup` skill): not applicable now

The skill sets up Vercel's own CI for **private** GitHub repositories, adds Turborepo, enables a dashboard setting and opens a pull request. This repository is **public**, so its first precondition fails and it must stop. The existing GitHub Actions workflow (`.github/workflows/ci.yml`) already runs schema validation, a fresh-database migration with a drift check, typecheck, lint, all Vitest suites against a real PostgreSQL, the production build, the Playwright suite and the dependency audit. Those need a database and a mail sink, which Vercel CI is not meant for. Keep GitHub Actions as the gate. Revisit only if the repository becomes private.
