# Production Deployment Guide

**Status: documentation only. Nothing has been deployed.** The hosting provider has not been chosen, no paid or public service is used, and nothing was exposed publicly. This guide is portable: it needs a Node.js runtime (or the provided container image), a PostgreSQL 17 database, an SMTP server, a persistent disk for uploads, HTTPS in front, and a scheduler. Verification status of each part is stated in *Verification status* at the end; read that before relying on a step.

## 1. Architecture to deploy

One Next.js application (frontend pages and backend API run in the same process) plus PostgreSQL. No other service is required. Mail goes through SMTP, uploads go to a directory, and a scheduler calls one endpoint (or a command) for housekeeping.

```text
Browser --HTTPS--> reverse proxy / platform (TLS, overwrites X-Forwarded-For) --HTTP--> ShadowTrix (npm start, port 3010) --> PostgreSQL 17
                                                                                   |--> SMTP server
                                                                                   |--> upload directory (persistent disk)
scheduler (cron or similar) --HTTPS POST /api/v1/internal/cleanup (Bearer CRON_SECRET)--> ShadowTrix
```

## 2. Production environment variables

Set these in the platform's secret store or the process environment. **Never put them in Git, in an image layer, or in logs.** Validation happens at start (`web/src/server/config/env.ts`); a wrong value stops the app with a message that names the variable but never prints its value.

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set by `npm start`/the image. Turns on the production checks below. |
| `APP_URL` | `https://your.public.address` | **Exactly the public origin, https, no trailing path.** Used for email links, the CSRF Origin check and the `__Host-` Secure session cookie. It is also **baked into prerendered pages at build time**, so build with the same value you run with (rebuild when it changes). Production refuses a non-https value except `localhost`. |
| `DATABASE_URL` | `postgresql://user:password@host:5432/dbname?schema=public` | Use a dedicated, least-privilege role (see 3). Add `sslmode=require` (or your provider's equivalent) when the database is not on a private network. |
| `AUTH_SECRET` | 32+ random characters | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Keys rate-limit hashing **and the encryption of administrators' TOTP secrets**: changing it makes enrolled authenticator secrets unreadable (use `npm run admin:mfa-reset -- <email>` for affected administrators). Rotate deliberately, not casually. Rejected if it looks like a placeholder. |
| `TRUST_PROXY` | `true` only behind a proxy you control | See 7. Leave `false` otherwise. |
| `SESSION_ABSOLUTE_TTL_DAYS`, `SESSION_IDLE_TTL_DAYS` | `30`, `7` (defaults) | Owner review of these lifetimes is still pending. |
| `CRON_SECRET` | 32+ random characters | Enables `POST /api/v1/internal/cleanup`. Unset keeps the endpoint off (404). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | your provider | See 5. |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR` | `local`, an absolute path on a persistent disk | See 6. `s3` is **not implemented**. |
| `ENABLE_STYLEGUIDE` | `false` | Keep the internal design-system page off. |

## 3. Database provisioning (PostgreSQL 17)

1. Create a database and **two roles**: an owner/migration role (can create tables) used only when running migrations, and an application role with `SELECT, INSERT, UPDATE, DELETE` on the tables and `USAGE` on sequences/types. The app does not need superuser rights; `pgcrypto` is not required.
2. Enable TLS and restrict network access to the application hosts. Keep backups (section 9).
3. Required settings: UTF-8 encoding, `timezone` any (the app stores `timestamptz` and formats in UTC).
4. Connection pool: the app opens a small pool per process; size `max_connections` for processes x pool + headroom.
5. Run migrations (section 4) with the owner role, then point `DATABASE_URL` at the application role.

## 4. Migrations

Migration history is **append-only**; never edit an applied migration. All 11 migrations are additive (new tables, columns that are nullable or defaulted, constraints, indexes). Hand-written constraints, triggers and partial indexes live in the migration SQL and are preserved by Prisma (it ignores triggers and partial indexes when comparing).

First deployment and every release:

```bash
cd web
npx prisma migrate status          # what is pending (read-only)
npx prisma migrate deploy          # applies pending migrations; never resets or drops data
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # exit 0 = no drift
```

**Never run `prisma migrate dev` or `migrate reset` against a real database** (they can drop data; the Prisma tooling also refuses `reset` for AI agents). Seed reference data on a new database once: `npm run db:seed` (it creates only the Team EU Shadow organization record and leadership unit and designation names, no people).

Migration risk notes (all verified on a fresh database; the data migrations were exercised on empty tables only):

| Migration | What to know |
|---|---|
| `...init`, `...integrity_checks` | Baseline schema and hand-written protections. |
| `...event_timeline_dates` | Adds nullable date columns. |
| `...auth_sessions_and_rate_limits` | New tables. |
| `...signup_password_after_verification` | `users.password_hash` becomes nullable and a CHECK is added. Safe because no verified user can have a NULL hash. |
| `...events_registrations_integrity` | Adds a slug-format CHECK and a registration cancelled-consistency CHECK: **it fails if existing rows violate them** (slugs not lowercase-hyphen, or a cancelled registration without a time). Check with the two `SELECT count(*)` queries in the migration comments before deploying onto non-empty data. |
| `...admin_mfa` | New tables. |
| `...teams_submissions_judging_certificates` | Backfills `team_members.event_id` from the team before making it NOT NULL, adds a composite foreign key, a trigger and a CHECK on submissions (`DRAFT` iff no submission time) that **fails if existing submissions break it**. |
| `...admin_and_analytics_support`, `...org_membership_null_term_unique`, `...drop_unused_audit_action_index` | Additive columns and indexes; building indexes on large tables takes a lock for the duration (seconds at the measured sizes). The unique index fails if duplicate (member, unit, designation) rows without a term already exist. |

**Rollback:** migrations have no automatic down step. Roll back a release by restoring the pre-release backup into a new database (section 9) and pointing the app at it, or, for an additive-only release, by redeploying the previous application version, which ignores new columns and tables. Take a backup immediately before `migrate deploy` every time.

## 5. Email (SMTP)

Any SMTP server works. Set `SMTP_*` and `EMAIL_FROM`; use a sender on a domain you control with SPF, DKIM and DMARC configured, or messages (account confirmation, password reset, team invitations) will be filtered as spam. With Gmail SMTP, `SMTP_PASSWORD` must be a **Google App Password**, never the account password; never commit it. The emails sent: account confirmation, "already registered" notice, password reset and change notices, team invitations. All links point to `APP_URL`. Check delivery with the first administrator onboarding ([first-administrator.md](first-administrator.md)).

## 6. File storage

Uploads (project files, leadership photos) are written under `STORAGE_LOCAL_DIR`. Requirements: an **absolute path on persistent storage** that survives restarts and redeploys (a container needs a mounted volume), writable by the app user, **outside any web root and never served directly** (the app serves files only through authorized routes), included in backups, and not shared between servers unless the filesystem is shared. Back it up together with the database: a database restore without its files leaves submissions with missing attachments (downloads answer 404). The S3-compatible driver is not implemented, so a host without a persistent disk is not yet supported.

## 7. HTTPS, cookies, reverse proxy and `TRUST_PROXY`

- Terminate TLS in front of the app (reverse proxy, load balancer or platform). `APP_URL` must be the https address, which makes session cookies `Secure` with the `__Host-` prefix. Serve only over https; redirect http to https at the proxy. The app sends HSTS.
- The proxy must pass `Host` and **overwrite (not append to) `X-Forwarded-For`** with the real client address. Only then set `TRUST_PROXY=true`; the app uses the right-most entry for IP rate limits. With `TRUST_PROXY=false` (default) only per-account limits apply, which still protects accounts but not against spraying from one address.
- Example (nginx), shown for shape only:

```nginx
location / {
  proxy_pass         http://127.0.0.1:3010;
  proxy_set_header   Host $host;
  proxy_set_header   X-Forwarded-For $remote_addr;   # overwrite, do not append
  proxy_set_header   X-Forwarded-Proto https;
  client_max_body_size 12m;                            # uploads are limited to 10 MB per file
}
```

- Do not expose the application port, PostgreSQL (5432) or the scheduler secret publicly. The Mailpit UI is a development tool; never deploy it.
- Session settings: HttpOnly, `SameSite=Lax`, absolute 30 days, idle 7 days, server-side revocation. Content-Security-Policy and the other security headers are set by the application (see the security review for the inline-script limitation).

## 8. Scheduled cleanup

Schedule the housekeeping job daily. It removes expired sessions and tokens, old rate-limit counters and stale unverified signups, never a verified account, and writes one audit entry.

```bash
# cron on a host with the project: 02:15 every day
15 2 * * *  cd /srv/shadowtrix/web && npm run -s maintenance:cleanup >> /var/log/shadowtrix-cleanup.log 2>&1
# or from any scheduler that can make an HTTPS request:
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your.public.address/api/v1/internal/cleanup
```

## 9. Backup and restore

What to back up: (1) the database, (2) the upload directory, (3) the secrets you hold (`AUTH_SECRET` especially) in your secret manager. Backups contain personal data: encrypt them at rest, restrict access, set a retention period, and test restores.

```bash
# backup (custom format, checksum written next to it; owner-only permissions)
DB_NAME=shadowtrix BACKUP_DIR=/var/backups/shadowtrix ./scripts/ops/backup.sh
# restore into a NEW, EMPTY database (it refuses a database that already has tables, and a damaged file)
DUMP=/var/backups/shadowtrix/shadowtrix-<timestamp>.dump TARGET_DB=shadowtrix_restored ./scripts/ops/restore.sh
```

Connection settings come from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` or `~/.pgpass`. Schedule at least daily, plus one immediately before every migration. Verified on the development stack: dump, restore into an empty database, identical row counts in all 35 tables, same constraints/triggers/indexes, `migrate status` up to date and zero schema drift, refusal to restore into a non-empty database and refusal of a tampered file (see the QA report).

## 10. Logging, monitoring and health

- Logs go to stdout as structured JSON with sensitive fields redacted (passwords, tokens, hashes, cookies). Collect them with the platform's log service. The audit trail (`audit_logs`, viewable by administrators) records security-relevant actions separately.
- `GET /api/health` returns 200 `{"status":"ok","database":"up"}` or 503 when the database is unreachable: use it for load-balancer and uptime checks. The container image has a `HEALTHCHECK` on it.
- Watch: 5xx rate, `auth.email_failed` log lines (mail trouble), disk space of the database and the upload directory, backup success, and the audit log for repeated `auth.*` failures.

## 11. Recovery procedures

| Situation | Action |
|---|---|
| Application crashed or bad release | Redeploy the previous version (additive migrations are compatible) or restore as in section 4 *Rollback*. |
| Database lost or corrupted | Provision a new database, `restore.sh` the latest backup, run `migrate status` and `migrate diff`, point `DATABASE_URL` at it, restore the upload directory from its backup. |
| Uploaded files lost | Restore the upload directory; until then downloads return 404 and organizers can ask teams to re-upload. |
| `AUTH_SECRET` lost or changed | Sessions and rate-limit keys reset harmlessly; administrators with two-step verification need `npm run admin:mfa-reset -- <email>`. |
| Administrator locked out | They use recovery codes; otherwise `admin:mfa-reset`, or `admin:grant` for a replacement administrator (needs database access). |
| Suspected account compromise | Suspend the account in Administration (ends its sessions at once), review its audit activity, then reset the password. |
| Mail not arriving | Check SMTP settings and the log for `auth.email_failed`; resend links from the login/confirmation pages. |

## 12. Release checklist

1. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (with the production `APP_URL`), `npm audit --omit=dev`.
2. Backup the database and the upload directory.
3. `prisma migrate status`, then `prisma migrate deploy`, then the drift check.
4. Start the new version; check `/api/health`; log in; open an event; check the administration overview.
5. Confirm the scheduled cleanup and backups are running.
6. First administrator: follow [first-administrator.md](first-administrator.md); never create default credentials.

## 13. Container image

`web/Dockerfile` builds the application (multi-stage, Debian-based Node 24 so the native Argon2 binding works):

```bash
docker build --build-arg APP_URL=https://your.public.address -t shadowtrix-web web
docker run --rm -p 127.0.0.1:3010:3010 --env-file production.env -v /srv/shadowtrix/storage:/data -e STORAGE_LOCAL_DIR=/data shadowtrix-web
```

Run migrations with the same image (`docker run ... npx prisma migrate deploy`) against the database. The image keeps the full dependency set because the Prisma CLI and `tsx` administration commands are needed in it; a smaller standalone image is possible future work.

## Verification status (honest)

| Part | Status |
|---|---|
| Production build, start, health, migrations on a fresh database, drift check, backup, restore, refusal cases | **Run and verified** locally |
| Scheduled cleanup (command and endpoint) | **Run and tested** (unit, integration and e2e) |
| TLS, reverse proxy, `TRUST_PROXY` behind a real proxy, secure-cookie behavior over real https | **Not tested**: no real https host exists yet; behavior is covered by unit tests of the cookie and client-IP logic only |
| Real SMTP provider (DKIM/SPF delivery) | **Not tested**; local Mailpit only |
| Container image | The **build stage ran successfully** (dependency install and production build inside Debian Node 24). The final image export failed because the development machine's disk was full, so the finished image was **never started**; treat the Dockerfile as untested until it is built and run once on a machine with space |
| Monitoring, alerting, log shipping | **Not set up** (no provider) |
| Load or stress testing beyond the measured query times | **Not done**; see the performance report |
