# Authentication and Authorization (Milestone 4)

Implemented in `web/src/server/modules/{auth,authz,admin,email,audit}` and `web/src/server/security`. Pages and route handlers stay thin and call these services (see [module-boundaries.md](module-boundaries.md)). API reference: [../api/auth-and-admin-api.md](../api/auth-and-admin-api.md).

## Design in one paragraph

Users register with email and password, confirm the address through an emailed single-use link, then log in. A successful login creates a **server-side session**: the browser receives a random opaque token in an HttpOnly cookie and the database stores only its SHA-256. Every request validates that session against the database (not revoked, not expired, not idle, user still active and verified) and loads the user's roles fresh. Authorization is decided on the server by a pure permission matrix; nothing the client sends is trusted for identity or role.

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

**Registration** `POST /api/v1/auth/register`: validate (Zod) → rate limit → hash password (always, on every path) → in one transaction create the user with the PARTICIPANT role and a verification token. The response is identical whether the address is new, unverified or already registered:

| Address state | What happens | Email sent to the address |
|---|---|---|
| New | Account created | "Confirm your email address" |
| Existing, unverified | Name and password replaced by the newest registration; old links voided | New confirmation link |
| Existing, verified | Nothing changes | "You already have an account" (to the real owner) |

**Email confirmation:** the link opens `/verify-email?token=…`, which only shows a button. The token is consumed by the POST the button sends, so mail scanners and link previewers (which fetch URLs automatically) cannot burn a single-use token.

**Login** `POST /api/v1/auth/login`: rate limit (per email, per IP when known) → look up user. Unknown email and wrong password return the same error at the same cost (a dummy Argon2 verification runs for unknown emails). Only after the password is proven correct does the server say "email not verified" or "suspended". Success mints a new session token (no session fixation), sets the cookie and writes an audit entry.

**Logout** `POST /api/v1/auth/logout`: revokes the session row and clears the cookie. Idempotent.

**Password reset:** `forgot-password` always answers the same; if an active account exists a 60-minute single-use link is emailed. `reset-password` consumes the token, sets the new hash, marks the email verified (the link proves mailbox control), revokes **every** session, voids other outstanding links, writes an audit entry and sends a "password changed" notice.

## Password policy and multi-factor authentication

- **Passwords:** 12 to 128 characters (owner-approved minimum of 12), not on the common-password list, not containing the part of the email before the `@`, not one repeated character. No composition rules (they push people to predictable patterns); spaces and Unicode are allowed and length is counted in characters. The limits live in one constant (`web/src/lib/password-policy.ts`) shared by the server validation and the form hints, and apply to registration and password reset. A change-password flow does not exist yet; when it is added it must use the same schema.
- **MFA:** policy is that administrator MFA will be **optional** and must never block an administrator who has not enrolled. It is **not implemented yet**; see [../planning/security-backlog.md](../planning/security-backlog.md).

## Sessions

| Property | Value |
|---|---|
| Cookie | `st_session` (`__Host-st_session`, with `Secure`, when `APP_URL` is https); HttpOnly; SameSite=Lax; Path=/ |
| Absolute lifetime | 30 days (`SESSION_ABSOLUTE_TTL_DAYS`) |
| Idle timeout | 7 days of no use (`SESSION_IDLE_TTL_DAYS`); `last_seen_at` is refreshed at most every 5 minutes |
| Revoked by | logout, password reset, re-registration of an unverified address, suspension |
| Rotation | New token at every login; all sessions replaced on password reset. There is no periodic rotation of a live session (see limitations). |
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
| Account enumeration | Identical responses and cost for register, login, resend, forgot-password | e2e compares bodies and status; timing test |
| Token theft from email | Single use, expiring, superseded by newer links, mail scanners cannot consume them | concurrency tests (exactly one winner) |
| Session fixation / replay | New token per login; server-side revocation | e2e replays a copied cookie after logout and reset |
| CSRF | Origin check, JSON-only bodies, SameSite=Lax | e2e: no/foreign/`null` Origin, form and `text/plain` posts |
| Open redirect | `safeNextPath` allows only same-site relative paths | unit table (`//evil`, `/\evil`, `javascript:`) and e2e |
| Privilege escalation | Roles read from the database; no role input accepted anywhere; matrix tests | e2e: forged cookies, self-promotion attempts |
| XSS in email | All user text HTML-escaped in templates | unit test |
| Information leaks | Redacting logger; allow-list DTOs; generic 500s; `Cache-Control: no-store` on API; `Referrer-Policy: no-referrer` on token pages | unit + e2e |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, HSTS, Permissions-Policy | e2e header test |

## Known limitations (honest list)

1. **No periodic session-token rotation** for a live session; rotation happens at login, password reset and suspension.
2. **No scheduled cleanup.** `purgeDeadSessions` and `purgeExpiredRateLimits` exist but nothing runs them yet; expired rows are harmless but accumulate. Unverified accounts are not auto-expired.
3. **Pre-registration risk is reduced, not eliminated.** If an attacker registers a victim's address with the attacker's password and the victim clicks the confirmation link anyway, the attacker's password is live. Mitigations: a newer registration replaces an unverified one, and the email says to ignore it if unexpected.
4. **No change-password screen for signed-in users, no email change, no multi-factor authentication (optional for admins by policy, not built), no social login, no "sign out other devices" screen.** Password reset covers recovery; the rest is planned work.
5. **Content-Security-Policy is not set yet** (needs a nonce strategy); scheduled for the hardening milestone.
6. **IP-based limits depend on `TRUST_PROXY`.** Route handlers cannot see the socket address, so without a trusted proxy only the per-account limits apply.
7. **The header is session-aware, so pages are no longer served as fully static, CDN-cacheable HTML** (`Cache-Control: private, no-store`). The prerendered shell still makes them fast; a CDN would not cache them.
8. **`APP_URL` is baked into prerendered metadata**, so it must be identical at build and run time.
9. **This is a self-review, not an independent security audit.** Obtain an external review (and a penetration test) before handling real users' data.
