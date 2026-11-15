# Security Hardening Backlog

Prioritized list of remaining security work. **Status values are honest: an item is marked Done only when it is implemented and tested.** Nothing below is currently Done unless stated.

Owner decisions that shape this list (recorded 2026-11-15): the first administrator is the owner's own account (email not yet supplied); administrator MFA will be **optional**, never mandatory; the password minimum is **12 characters**; merging and granting the admin role need explicit approval.

## Critical before public launch

| # | Item | Why it matters | Status |
|---|---|---|---|
| C1 | **Close the pre-registration takeover risk.** Registration collects only an email; the mailbox owner chooses name and password on the emailed link's page. | Previously an attacker could register a victim's address with a password they know. | **Done and tested** on `feature/milestone-4-authentication` (migration `20261115180000`, unit + integration + e2e tests, CI pending on the new commit). Not yet independently reviewed (see C6). |
| C2 | **Content-Security-Policy.** | Limits the damage of any future XSS. | **Partly done.** A restrictive same-origin policy is sent and tested (no external scripts, frames, images, fonts or connections). It still allows `'unsafe-inline'` scripts/styles, so injected *inline* script is not blocked. A nonce/hash policy needs per-request rendering and is open. |
| C3 | **Session lifecycle:** time-based rotation of a live token, concurrent-session limits, and the lifetimes (30 days absolute / 7 days idle). | Shortens the window for a stolen cookie. | **Partly done.** Done and tested: revocation on logout, reset, suspension, password change (all devices) and role grant/revoke; new token at login and password change. Open: time-based rotation (cannot set cookies while rendering), session limits, owner review of lifetimes. |
| C4 | **Scheduled cleanup** of expired sessions, spent and expired tokens, rate-limit rows, and unverified accounts past a grace period. | Bounded table growth. | **Job implemented and tested** (`npm run maintenance:cleanup`, protected `POST /api/v1/internal/cleanup`). **Not yet scheduled:** a scheduler must be chosen with the hosting decision. |
| C5 | **Change-password for signed-in users.** | Users must be able to rotate a password without the email reset flow. | **Done and tested** (unit, integration, e2e): current password required, same policy, revokes all sessions and rotates this one, emails a notice, rate limited. |
| C6 | **Independent security review and penetration test** before any real user data is handled. | Everything so far is self-reviewed. | Open |

## Additional improvements

| # | Item | Status |
|---|---|---|
| A1 | **Optional MFA for administrators** (TOTP and recovery codes). | **Done and tested** (RFC 6238 vectors, replay and concurrency, recovery codes, e2e UI flow), still optional and never blocking. Open within A1: a shorter admin session policy, step-up re-authentication for sensitive admin actions, QR code, WebAuthn. |
| A2 | Correct the footer "Account" column when signed in (it still shows Login and Register; those links redirect to the dashboard). | Open |
| A9 | Event times are entered and shown in UTC only (the event time zone is stored but the form does not offer it). | Open |
| A10 | The public event page answers `200` with a not-found view for unknown or hidden events (the page streams), marked `noindex`. A real `404` status would need the lookup before the first byte. | Open |
| A3 | Test in Firefox and Safari (only Edge locally and Chromium in CI so far). | Open |
| A4 | Test on real mobile devices. | Open |
| A5 | Manual screen-reader review (NVDA, VoiceOver); automated axe checks catch only part of accessibility problems. | Open |
| A6 | Email change flow; "sign out other devices"; a management interface for administrators (currently API plus a read-only list). | Open |
| A7 | Rotate the CI `latest` Mailpit image to a pinned version; update GitHub Actions to versions that run on a supported Node runtime. | Open |
| A8 | Review proxy and hosting assumptions (`TRUST_PROXY`, `APP_URL`, HTTPS) once a hosting target is chosen. | Open (depends on hosting decision) |

## Done and verified (for reference)

Signup redesign (C1): registration accepts only an email, the password is chosen by the verified mailbox owner, single-use atomic token, CHECK constraint forbids verified-without-password; tests include the attacker scenario, replay, 5 to 8-way concurrency, expiry, scanner prefetch and a rejected password not consuming the link. Argon2id hashing; hashed single-use tokens with concurrency tests; server-side sessions with revocation; role matrix and admin safeguards; rate limiting; Origin-based CSRF; open-redirect protection; enumeration resistance; 12-character password policy (registration and reset); security headers except CSP. See [authentication.md](../architecture/authentication.md) and the [Milestone 4 report](milestone-4-report.md).

## Decisions needed from the owner

1. **Approve the pull requests** (PR 1 for Milestone 3, then PR 2 for Milestone 4) and authorize the merges. See [pull-requests.md](pull-requests.md). Nothing has been merged.
2. **First administrator:** supply the owner's own account email when ready, and approve running `npm run admin:grant -- <email>`. Prerequisite: the account must already be registered and email-confirmed. No administrator has been granted and no default credentials exist.
3. ~~C1 design approval~~ Implemented under the accelerated work package; review it in PR 2. Note for you: the signup now has two steps and registration no longer asks for a name or password.
4. **Admin MFA scope (A1):** confirm TOTP with recovery codes, optional for administrators; and whether administrators should get a shorter session lifetime or step-up re-authentication even without MFA.
5. **Session lifetimes (C3):** confirm 30 days absolute / 7 days idle, or choose shorter values.
6. **Sequence:** which items (C1 to C6) must be finished before Milestone 5, and which can run alongside it.
7. **Hosting target**, which fixes `TRUST_PROXY`, `APP_URL`, HTTPS and the choice of scheduler for cleanup (C4).
8. **Independent security review (C6):** who performs it and when.
