# Security Hardening Backlog

Prioritized list of remaining security work. **Status values are honest: an item is marked Done only when it is implemented and tested.** Nothing below is currently Done unless stated.

Owner decisions that shape this list (recorded 2026-11-15): the first administrator is the owner's own account (email not yet supplied); administrator MFA will be **optional**, never mandatory; the password minimum is **12 characters**; merging and granting the admin role need explicit approval.

## Critical before public launch

| # | Item | Why it matters | Status |
|---|---|---|---|
| C1 | **Close the pre-registration takeover risk.** Let the email owner set their password *after* verifying the email (registration collects only name and email; the confirmation link leads to a "choose your password" step). | Today an attacker can register a victim's address with a password they know; if the victim clicks the confirmation link anyway, the attacker's password is live. Newer registrations replace unverified ones, which only reduces the risk. | Open (changes the signup flow; needs a design review) |
| C2 | **Content-Security-Policy** after reviewing every script, style, font and image source (Next.js needs a nonce strategy). | Limits the damage of any future XSS. | Open |
| C3 | **Review session token lifecycle and rotation:** periodic rotation of a live session token, rotation on privilege change, concurrent-session limits, and the lifetimes (30 days absolute / 7 days idle). | Shortens the window for a stolen cookie. | Open (revocation on logout, reset and suspension already exists and is tested) |
| C4 | **Scheduled cleanup** of expired sessions, spent and expired tokens, rate-limit rows, and unverified accounts past a grace period. | Bounded table growth; stale unverified accounts are takeover bait (see C1). Functions `purgeDeadSessions` and `purgeExpiredRateLimits` exist but nothing runs them. | Open |
| C5 | **Change-password for signed-in users** (current password required, same 12-character policy, revokes other sessions, notifies by email). | Users must be able to rotate a password without the email reset flow. | Open (not started; deliberately not added as a partial flow) |
| C6 | **Independent security review and penetration test** before any real user data is handled. | Everything so far is self-reviewed. | Open |

## Additional improvements

| # | Item | Status |
|---|---|---|
| A1 | **Optional MFA for administrators** (TOTP and recovery codes). Must not block administrators who have not enrolled. Also review a shorter admin session policy (idle and absolute lifetime) and step-up re-authentication for sensitive admin actions. | Open |
| A2 | Correct the footer "Account" column when signed in (it still shows Login and Register; those links redirect to the dashboard). | Open |
| A3 | Test in Firefox and Safari (only Edge locally and Chromium in CI so far). | Open |
| A4 | Test on real mobile devices. | Open |
| A5 | Manual screen-reader review (NVDA, VoiceOver); automated axe checks catch only part of accessibility problems. | Open |
| A6 | Email change flow; "sign out other devices"; a management interface for administrators (currently API plus a read-only list). | Open |
| A7 | Rotate the CI `latest` Mailpit image to a pinned version; update GitHub Actions to versions that run on a supported Node runtime. | Open |
| A8 | Review proxy and hosting assumptions (`TRUST_PROXY`, `APP_URL`, HTTPS) once a hosting target is chosen. | Open (depends on hosting decision) |

## Done and verified (for reference)

Argon2id hashing; hashed single-use tokens with concurrency tests; server-side sessions with revocation; role matrix and admin safeguards; rate limiting; Origin-based CSRF; open-redirect protection; enumeration resistance; 12-character password policy (registration and reset); security headers except CSP. See [authentication.md](../architecture/authentication.md) and the [Milestone 4 report](milestone-4-report.md).
