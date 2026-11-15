# API Reference: Authentication and Administration (v1)

Base path `/api/v1`. JSON in, JSON out. Events, registrations and profile endpoints: [events-and-dashboards-api.md](events-and-dashboards-api.md). Design notes: [../architecture/authentication.md](../architecture/authentication.md).

## Conventions

- **Authentication:** an HttpOnly session cookie set by `POST /auth/login`. There are no bearer tokens.
- **State-changing requests** (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` header equal to the site's own origin (browsers send it automatically; non-browser clients must add it) or `Sec-Fetch-Site: same-origin`. Otherwise: `403 csrf_check_failed`. `POST`/`PUT`/`PATCH` must also send `Content-Type: application/json`, otherwise `415 unsupported_media_type`.
- **Responses** are never cached (`Cache-Control: no-store`).
- **Errors** share one shape and never include stack traces or internals:

```json
{ "error": { "code": "invalid_credentials", "message": "Incorrect email or password." } }
```

Validation errors add `issues: [{ "path": ["password"], "message": "Use at least 12 characters." }]`.

| Status | Meaning |
|---|---|
| 400 | `validation_error`, `invalid_json`, `invalid_token`, `invalid_current_password`, `invalid_mfa_code`, `invalid_timeline`, `role_not_assignable`, `base_role` |
| 401 | `unauthorized` (no/invalid session), `invalid_credentials`, `mfa_required`, `invalid_mfa_code` |
| 403 | `forbidden`, `csrf_check_failed`, `email_not_verified`, `account_suspended` |
| 404 | `not_found` |
| 409 | `cannot_demote_self`, `cannot_suspend_self`, `last_admin`, `mfa_already_enabled`, `registration_*` (see events API), `conflict` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (with `Retry-After` seconds) |

## Authentication

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `POST /auth/register` | `{ email }` | `202 { status, message }` | Step 1. Same response for new, pending and existing addresses. Extra fields (such as a password or name) are ignored and never stored. |
| `POST /auth/complete-registration` | `{ token, fullName, password }` | `200 { status: "ok" }` | Step 2. Token is single use and valid 24 hours; it is consumed only if the password is accepted. Password: 12 to 128 characters, not common, not containing the email name (400 `validation_error` on field `password`). 400 `invalid_token` for unknown, used, expired or wrong-type tokens. Replaces the former `POST /auth/verify-email`, which no longer exists. |
| `POST /auth/resend-verification` | `{ email }` | `202` | Same response for every address. |
| `POST /auth/login` | `{ email, password, code? }` | `200 { user: { id, email, fullName } }` + `Set-Cookie` | The session token is only in the cookie, never in the body. 403 `email_not_verified` / `account_suspended` appear only after a correct password. For an account that turned on optional two-step verification: `401 mfa_required` (no `code` sent) or `401 invalid_mfa_code`, again only after a correct password. |
| `POST /auth/logout` | none (send `{}`) | `200` | Revokes the session; always clears the cookie. |
| `GET /auth/me` | | `200 { user: { id, email, fullName, roles[] }, permissions[] }` | `401` when signed out. Permissions are computed on the server. |
| `POST /auth/forgot-password` | `{ email }` | `202` | Same response for every address. Reset link valid 60 minutes, single use. |
| `POST /auth/reset-password` | `{ token, password }` | `200` | Revokes all of the user's sessions. |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` | `200` + new `Set-Cookie` | Signed in. Needs the current password (`400 invalid_current_password`), same 12 to 128 character policy, new password must differ. Revokes **every** session (all other devices) and issues a fresh one for this browser; emails a notice. 5 attempts per 15 minutes. |
| `POST /auth/mfa/enroll` | none | `200 { secret, uri }` | Optional, administrators only (`403` otherwise). Starts set-up; inactive until confirmed. `409 mfa_already_enabled`. |
| `POST /auth/mfa/confirm` | `{ code }` | `200 { recoveryCodes[10] }` | Turns two-step verification on after a correct authenticator code. Recovery codes are shown once; only their hashes are stored. |
| `POST /auth/mfa/disable` | `{ password, code }` | `200` | Needs the password and a current or recovery code. |
| `POST /internal/cleanup` | none | `200 { sessions, tokens, rateLimits, unverifiedAccounts }` | Scheduler hook. `Authorization: Bearer <CRON_SECRET>`; `404` when `CRON_SECRET` is not configured, `401` for a wrong secret. No cookie or Origin needed. |

## Administration (administrators only: 401 anonymous, 403 any other role)

| Method and path | Body / query | Success |
|---|---|---|
| `GET /admin/users` | `?page=1&pageSize=25&q=` (pageSize max 100) | `200 { items[], total, page, pageSize }`. Items contain `id, email, fullName, status, emailVerified, roles[], createdAt, lastLoginAt` and nothing else. |
| `POST /admin/users/{id}/roles` | `{ role }` (`PARTICIPANT`, `ORGANIZER`, `JUDGE`, `ADMIN`) | `200` user view. Idempotent. `TEAM_LEADER` is rejected (derived role). |
| `DELETE /admin/users/{id}/roles/{role}` | none | `200` user view. `409` when removing your own admin role or the last administrator; `400` for the base participant role. |
| `PATCH /admin/users/{id}/status` | `{ status: "ACTIVE" \| "SUSPENDED" }` | `200` user view. Suspending revokes every session at once; you cannot suspend yourself. |

`{id}` must be a UUID (`400` otherwise).

## Rate limits (fixed windows)

| Action | Limit | Key |
|---|---|---|
| Login | 8 per 15 min | email; plus 40 per 15 min per IP when `TRUST_PROXY=true` |
| Register | 5 per hour | email; 10 per hour per IP |
| Forgot password | 5 per hour | email; 20 per hour per IP |
| Resend verification | 5 per hour | email; 20 per hour per IP |
| Verify / reset submit | 20 per 15 min | IP |

## Health

`GET /api/health` (unversioned): `200 { status: "ok", database: "up" }` or `503` when the database is unreachable.
