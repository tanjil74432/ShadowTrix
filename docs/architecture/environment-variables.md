# Environment Variables

Configuration is read from the environment and validated once by `web/src/server/config/env.ts` (Zod). Error messages name the variable and never echo its value. Template: [`web/.env.example`](../../web/.env.example). The real `.env` is git-ignored.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | none | PostgreSQL connection string. `prisma generate` (run by `npm install`) works without it; every command that connects needs it. |
| `APP_URL` | no | `http://localhost:3010` | Public origin. Used for links in emails, the CSRF origin check and the cookie `Secure`/`__Host-` decision. **Must be the same at build time and run time** (it is baked into prerendered metadata). In production it must be `https://` (only localhost may use `http`). |
| `AUTH_SECRET` | production, and any auth use | none | 32+ random characters. Keys the HMAC of emails/IPs in rate-limit counters. Rejected in production if it looks like a placeholder (`change-me`, `dev-only`, `example`). Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Rotating it only resets rate-limit counters; it does not invalidate sessions or passwords. |
| `TRUST_PROXY` | no | `false` | Set `true` **only** behind a reverse proxy that overwrites `X-Forwarded-For`; the right-most entry is then used for IP rate limits. When `false`, IP limits are skipped and per-account limits still apply. |
| `SESSION_ABSOLUTE_TTL_DAYS` | no | `30` | Maximum session age (1 to 90). |
| `SESSION_IDLE_TTL_DAYS` | no | `7` | Session dies after this many unused days (1 to 30). |
| `CRON_SECRET` | no | unset | 32+ random characters. Bearer secret for `POST /api/v1/internal/cleanup`. Unset = endpoint disabled (404). Never commit it. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | no | `localhost`, `1025`, `false`, none, none | Outgoing email. Mailpit (docker compose) in development. |
| `EMAIL_FROM` | no | `ShadowTrix <no-reply@shadowtrix.local>` | Sender. Use a real, authenticated domain in production. |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR` | no | `local`, `./.storage` | Private file storage for project uploads (Milestone 7). `local` writes under `STORAGE_LOCAL_DIR` (git-ignored; back it up and keep it out of any web root). **`s3` is not implemented yet**: selecting it makes the first upload fail with a clear error. `S3_*` variables are reserved for that future driver. |
| `ENABLE_STYLEGUIDE` | no | `false` | Exposes the internal `/design-system` page. Keep `false` in production. |

Test-only (not read by the app): `MAILPIT_URL` (default `http://localhost:8025`) tells the Playwright tests where to read emails. The e2e suite generates its own random `AUTH_SECRET` per run.

## Ports (development)

App 3010, e2e server 3011, PostgreSQL 5433 (host), Mailpit SMTP 1025 and UI 8025.
