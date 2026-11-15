# First administrator onboarding

Intended first administrator: the owner's account, **tanjilshaiket74432@gmail.com**.

**Status (2026-11-15): not granted.** The account has not been registered, no administrator role exists, `npm run admin:grant` has never been run and no default credentials exist. The role is granted only after the owner's explicit confirmation at the moment of execution (step 5).

## Rules

- The ShadowTrix account password is separate from the Gmail password. **Never give the Gmail password to anyone or to any tool.**
- The assistant never invents, generates, requests or stores the ShadowTrix password. The owner types it into the website themselves.
- No credentials appear in Git, logs, reports, screenshots or source code. `.env` is git-ignored.
- Administrator MFA is optional by policy and not built yet; being an administrator without MFA is allowed.

## Steps

### 0. Prerequisites
- Milestones 3 and 4 merged (owner approval), the app and database running, migrations applied (`npm run db:migrate` or `npx prisma migrate deploy`).
- A mail path that really delivers to the owner's inbox:
  - **Local development:** Mailpit (`docker compose up -d`) catches all mail; read the link at http://localhost:8025. This is enough to test the flow, but the message never reaches Gmail.
  - **Real inbox (staging or production):** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` in the **local, git-ignored** environment file. For Gmail SMTP, `SMTP_PASSWORD` must be a **Google App Password** (requires 2-Step Verification on the Google account), not the account password. Restart the app after changing it.

### 1. Register (step 1 of signup)
Open `/register` and enter `tanjilshaiket74432@gmail.com`. No password is asked for here, by design.

### 2. Confirm the email and choose the password (step 2)
Open the emailed link (valid 24 hours, single use). On that page enter your name and choose your ShadowTrix password (at least 12 characters), then press **Confirm email and activate account**. Opening the link alone changes nothing.

### 3. Confirm the account is active
Log in at `/login`; you should reach the dashboard. Read-only database check (optional):

```sql
SELECT email, email_verified_at IS NOT NULL AS verified, status FROM users WHERE email = 'tanjilshaiket74432@gmail.com';
-- expected: verified = true, status = ACTIVE
```

### 4. Owner confirmation
Tell the assistant, in writing, that the account in step 3 is yours and that the administrator role may be granted now.

### 5. Grant (run only after step 4)
From the `web` folder, with `DATABASE_URL` pointing at the target database:

```bash
npm run admin:grant -- tanjilshaiket74432@gmail.com
```

The command refuses an unknown, unconfirmed or suspended account (exit code 1), is idempotent, serializes with an advisory lock and writes an `admin.bootstrap_grant` audit entry. It is the only supported way to create the first administrator.

### 6. Verify
Log out and in again. `/admin` should open, and `GET /api/v1/auth/me` should list the `ADMIN` role. From then on, further administrators and roles are managed through the admin API, which protects against self-demotion and removing the last administrator.

## If something goes wrong
- **No email arrives:** check spam, Mailpit (development), the SMTP variables, and the application log (`auth.email_failed`). Request a new link from `/verify-email` (earlier links stop working).
- **"This link is invalid or has expired":** links work once and expire after 24 hours; request a new one.
- **`Not granted: ...`:** the message says which prerequisite is missing.
- **Locked out later:** use `/forgot-password`.
