# Authentication and Authorization (Milestone 4)

Implemented in `web/src/server/modules/{auth,authz,admin,email,audit}` and `web/src/server/security`. Pages and route handlers stay thin and call these services (see [module-boundaries.md](module-boundaries.md)). API reference: [../api/auth-and-admin-api.md](../api/auth-and-admin-api.md).

## Design in one paragraph

Signup has two steps: the visitor enters **only an email address**, then proves they own the mailbox through an emailed single-use link and **chooses their name and password on that page**. After that they log in. A successful login creates a **server-side session**: the browser receives a random opaque token in an HttpOnly cookie and the database stores only its SHA-256. Every request validates that session against the database (not revoked, not expired, not idle, user still active and verified) and loads the user's roles fresh. Authorization is decided on the server by a pure permission matrix; nothing the client sends is trusted for identity or role.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Session model | Opaque random token + database row | Real revocation (logout, password reset, suspension take effect immediately); a leaked database cannot be replayed because only hashes are stored. Stateless JWTs cannot be revoked without extra state. |
| Password hashing | Argon2id, 64 MiB / 3 passes / 1 lane (`@node-rs/argon2`) | Above the OWASP minimum (19 MiB / 2 / 1); about 120 ms per hash on a laptop. Parameters live in each hash, so they can be raised later and users are re-hashed at next login. |
| Tokens | 256 bits from the OS CSPRNG; SHA-256 stored | Nothing to brute-force, so a fast hash is correct. |
| Rate limiting | Fixed windows in Postgres, HMAC-keyed | Works across instances and restarts with no new infrastructure. |
| CSRF | Origin / Sec-Fetch-Site check + JSON content type + SameSite=Lax cookie | Layered; the first two are enforced centrally in `apiHandler`. |
| Email | Nodemailer over SMTP, sent after the response (`after()`) | Provider-agnostic; response time does not depend on SMTP. |
| Where checks run | Data access layer (`dal.ts`) close to the data, never in layouts | Layouts do not re-render on navigation (Next.js guidance). |

## Flows

**Step 1, registration** `POST /api/v1/auth/register` `{ email }`: validate (Zod; any other field is ignored) → rate limit → in one transaction create a **pending** user (PARTICIPANT role, `password_hash` NULL, email unverified, neutral placeholder name) and a verification token. The response is identical whether the address is new, pending or already registered:

| Address state | What happens | Email sent to the address |
|---|---|---|
| New | Pending account created (no password) | "Confirm your email address" |
| Existing, pending | Nothing about the account changes; older links voided | New confirmation link |
| Existing, verified | Nothing changes | "You already have an account" (to the real owner) |

**Step 2, completion** `POST /api/v1/auth/complete-registration` `{ token, fullName, password }`: the emailed link opens `/verify-email?token=…`, which shows a form. Only submitting the form calls the API, so mail scanners and link previewers (which fetch URLs automatically) cannot consume the token or choose a password. The service first checks the token and the password policy (including the email-name rule) *without consuming anything*, so a rejected password never wastes the link. It then hashes the password and, in one transaction, atomically claims the token (exactly one caller wins, even under concurrency), stores the hash and name, marks the email verified, voids other outstanding links and writes an audit entry. Unknown, used, expired, wrong-type or suspended-account tokens all return the same `invalid_token`.

**Why this closes the pre-registration takeover:** a password can only be set by the holder of an emailed token, i.e. the mailbox owner. An attacker who registers a victim's address creates a pending account with no credentials; login with it fails exactly like an unknown address. Database guarantee: CHECK `users_verified_requires_password_chk` makes a verified account without a password impossible. Pending accounts cannot use password reset (that flow only serves accounts that have a password).

**Login** `POST /api/v1/auth/login`: rate limit (per email, per IP when known) → look up user. Unknown email and wrong password return the same error at the same cost (a dummy Argon2 verification runs for unknown emails). Only after the password is proven correct does the server say "email not verified" or "suspended". Success mints a new session token (no session fixation), sets the cookie and writes an audit entry.

**Logout** `POST /api/v1/auth/logout`: revokes the session row and clears the cookie. Idempotent.

**Password reset:** `forgot-password` always answers the same; if an active account exists a 60-minute single-use link is emailed. `reset-password` consumes the token, sets the new hash, marks the email verified (the link proves mailbox control), revokes **every** session, voids other outstanding links, writes an audit entry and sends a "password changed" notice.

## Password policy and multi-factor authentication

- **Passwords:** 12 to 128 characters (owner-approved minimum of 12), not on the common-password list, not containing the part of the email before the `@`, not one repeated character. No composition rules (they push people to predictable patterns); spaces and Unicode are allowed and length is counted in characters. The limits live in one constant (`web/src/lib/password-policy.ts`) shared by the server validation and the form hints, and apply to registration and password reset. Signed-in **change-password** (`POST /auth/change-password`) uses the same rules, requires the current password, signs out every other device and rotates this browser's session.
- **MFA (optional, administrators):** TOTP (RFC 6238; SHA-1, 6 digits, 30 s; verified against the RFC's published test vectors) with 10 one-time recovery codes. It is **never mandatory**: an administrator who has not enrolled signs in with the password alone, and nothing blocks them. Enrollment is in *Account settings* and is inactive until a correct code is confirmed. The secret is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`; losing or changing `AUTH_SECRET` makes enrolled secrets unreadable, use `npm run admin:mfa-reset -- <email>`), recovery codes only as SHA-256 hashes. At login the code is requested only **after** the password was correct; each time step is accepted once (replay and concurrent use are rejected atomically) and each recovery code works once. Turning it off needs the password and a valid code. Break-glass for a lost device and lost recovery codes: `npm run admin:mfa-reset -- <email>` (database access required; audited; revokes the account's sessions).

## Sessions

| Property | Value |
|---|---|
| Cookie | `st_session` (`__Host-st_session`, with `Secure`, when `APP_URL` is https); HttpOnly; SameSite=Lax; Path=/ |
| Absolute lifetime | 30 days (`SESSION_ABSOLUTE_TTL_DAYS`) |
| Idle timeout | 7 days of no use (`SESSION_IDLE_TTL_DAYS`); `last_seen_at` is refreshed at most every 5 minutes |
| Revoked by | logout, password reset, password change (all devices), suspension, a role being granted or revoked (the person signs in again and gets a fresh token) |
| Rotation | New token at every login and password change; all sessions replaced on password reset and on privilege changes. There is no time-based rotation of a live session (see limitations). |
| Stored | token hash, timestamps, revocation reason, truncated user agent. No IP address. |

## Authorization

Roles: Participant, Team Leader (derived from team membership, never granted by hand), Organizer, Judge, Administrator. `ROLE_PERMISSIONS` in `authz/permissions.ts` maps each role to permissions; `can(actor, permission, scope)` is a pure function:

- a platform-wide grant covers everything; an event- or organization-scoped grant covers only that scope and **never** satisfies a request that names no scope;
- unknown or forged role strings grant nothing;
- the whole matrix is asserted cell by cell in `tests/authz.test.ts`.

Enforcement points:

| Layer | Mechanism | Failure behavior |
|---|---|---|
| API routes | `requireApiPermission()` | 401 anonymous, 403 wrong role |
| Pages | `ProtectedArea` / `requirePageAccess()` | Anonymous: redirect to `/login?next=…`. Signed in without the role: access-denied view; the protected children are never rendered, so no protected data is fetched |
| Services | Each admin service re-checks permission and, inside a lock, that the acting admin is *still* an active admin | 403 |

Administrator safeguards (`admin-users.service.ts`): cannot demote or suspend yourself; cannot remove the last active administrator; every role/status change is serialized with a Postgres advisory lock so two admins demoting each other simultaneously cannot leave zero admins (tested); TEAM_LEADER cannot be granted; PARTICIPANT cannot be removed; all changes are audited; suspension revokes all sessions at once.

**First administrator:** there are no default credentials. Register and confirm an account normally, then run `npm run admin:grant -- person@example.com` on the server (requires database access). It refuses unknown, unconfirmed or suspended accounts and writes an audit entry.

## Threats considered and controls

| Threat | Control | Verified by |
|---|---|---|
| Stolen database | Argon2id hashes; session and token hashes only; HMAC-keyed rate-limit keys | unit + integration tests assert raw tokens never appear in the database |
| Credential stuffing, brute force | 8 attempts / 15 min per email, 40 / 15 min per IP (when trustworthy), generic errors | service + e2e tests (429, `Retry-After`) |
| Pre-registration takeover | Registration accepts only an email; the password is chosen by the mailbox owner via the emailed token; DB CHECK forbids verified-without-password | unit, integration and e2e tests of the attacker scenario, replay, concurrency, scanner prefetch |
| Account enumeration | Identical responses and cost for register, login, resend, forgot-password | e2e compares bodies and status; timing test |
| Token theft from email | Single use, expiring, superseded by newer links, mail scanners cannot consume them | concurrency tests (exactly one winner) |
| Session fixation / replay | New token per login; server-side revocation | e2e replays a copied cookie after logout and reset |
| CSRF | Origin check, JSON-only bodies, SameSite=Lax | e2e: no/foreign/`null` Origin, form and `text/plain` posts |
| Open redirect | `safeNextPath` allows only same-site relative paths | unit table (`//evil`, `/\evil`, `javascript:`) and e2e |
| Privilege escalation | Roles read from the database; no role input accepted anywhere; matrix tests | e2e: forged cookies, self-promotion attempts |
| XSS in email | All user text HTML-escaped in templates | unit test |
| Information leaks | Redacting logger; allow-list DTOs; generic 500s; `Cache-Control: no-store` on API; `Referrer-Policy: no-referrer` on token pages | unit + e2e |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, HSTS, Permissions-Policy | e2e header test |

## Scheduled cleanup

`runCleanup` (`web/src/server/modules/maintenance/cleanup.core.ts`) removes: sessions expired or revoked more than 7 days ago; auth tokens expired or used more than 7 days ago (live tokens are never touched); rate-limit counters older than a day; and **stale unverified signups** (older than 7 days, no password, never logged in, no registrations or created events, no sessions, only the base participant role). A verified account is never deleted. It writes one `maintenance.cleanup` audit row with the counts. Run it with `npm run maintenance:cleanup`, or call `POST /api/v1/internal/cleanup` with `Authorization: Bearer <CRON_SECRET>` (the endpoint is off unless `CRON_SECRET`, 32+ characters, is set). Suggested schedule: daily.

## Known limitations (honest list)

1. **No time-based rotation of a live session token.** Rotation happens at login, password change, password reset, suspension and role changes. A time-based rotation needs to set a cookie while a page renders, which Next.js does not allow; it would have to be done in an API call or a proxy and was not built. Lifetimes (30 days absolute, 7 days idle) are unchanged and still need the owner's review. Administrators do not have a shorter session policy yet.
2. **Cleanup exists but something must call it.** `npm run maintenance:cleanup` (once) or `POST /api/v1/internal/cleanup` with `Authorization: Bearer <CRON_SECRET>` runs it; the platform does not schedule it by itself. Pick a free scheduler once hosting is chosen (cron, a GitHub Actions schedule, or the host's cron feature). See *Scheduled cleanup* below.
3. **Pending accounts are removed by the cleanup job** after 7 days (only accounts with no password, no login, no registrations or events and only the base role). Residual nuisance: anyone can trigger confirmation emails to an address (rate limited per address and per IP), and a new request voids the previous link.
4. **No email change, no social login, no "sign out other devices" screen, no session list.** MFA is available to administrators only, and only TOTP (no WebAuthn or SMS). The setup key is shown as text (no QR code) to avoid a dependency.
5. **The Content-Security-Policy allows `'unsafe-inline'` for scripts and styles.** Next.js needs inline bootstrap scripts and a nonce-based policy would force every page to render per request, giving up the static shell. Everything else is locked to our own origin (no external scripts, frames, images, fonts, or connections; `object-src 'none'`, `base-uri`/`form-action` self, `frame-ancestors 'none'`). An injected external script is blocked (e2e-tested); an injected *inline* script would not be. A nonce or hash policy is open work.
6. **IP-based limits depend on `TRUST_PROXY`.** Route handlers cannot see the socket address, so without a trusted proxy only the per-account limits apply.
7. **The header is session-aware, so pages are no longer served as fully static, CDN-cacheable HTML** (`Cache-Control: private, no-store`). The prerendered shell still makes them fast; a CDN would not cache them.
8. **`APP_URL` is baked into prerendered metadata**, so it must be identical at build and run time.
9. **This is a self-review, not an independent security audit.** Obtain an external review (and a penetration test) before handling real users' data.
