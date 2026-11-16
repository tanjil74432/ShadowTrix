# Security Review (self-review)

**This is not an independent security audit or a penetration test, and the platform must not be described as audited.** It is the project's own review with automated evidence. An external review remains a separate requirement before real user data is handled (backlog C6).

Method: reading the code against the checklist below, writing tests that attack each control, fixing what failed, and recording what is still open. Test files named here are in `web/tests` and `web/e2e`.

## Findings from this review (all fixed unless marked open)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **A NUL byte (`%00`) in any search box caused a database error and a 500 page** (users, events, audit, members). Not exploitable beyond a denial of that request, but it is user-controlled input reaching the database layer | Medium | **Fixed**: search input is cleaned centrally (`stripNul`), covered by unit and e2e tests |
| 2 | The unique key `(member, unit, designation, term)` of leadership positions did not stop duplicates when the term was empty (NULLs are distinct in SQL) | Low | **Fixed** by a partial unique index (migration `...org_membership_null_term_unique`), found by the new admin tests |
| 3 | Responses advertised the framework (`X-Powered-By: Next.js`) | Low | **Fixed** (`poweredByHeader: false`), asserted by a header test |
| 4 | Event update and status changes took the event row lock before checking authorization (a person without access could stall an event) | Medium | **Fixed** in the previous package; re-verified here |
| 5 | A role change left old sessions alive | Medium | **Fixed** in the previous package; re-verified |
| 6 | The content-security-policy still allows inline scripts and styles | Medium | **Open** (documented limit; external scripts, frames, images and connections are blocked) |
| 7 | No malware scanning of uploads; ZIPs are stored unopened | Medium | **Open** (documented) |
| 8 | No independent review; no automated dependency or secret scanning in CI beyond `npm audit` and the secrets test | Medium | **Open** |
| 9 | S3 storage and time-based session rotation are not built | Low | **Open** (documented) |

## Coverage by area

| Area | Controls | Evidence (tests that actually ran) |
|---|---|---|
| Authentication | Argon2id, email verified before the password is set, 12-character minimum, enumeration resistance, single-use hashed tokens | `auth-password`, `auth-service`, `hardening` (unit/integration) and `auth.spec` (e2e) |
| Authorization (RBAC) | Server-side permission functions, event-scoped roles, ownership checks on every object | `authz`, `events`, `teams`, `judging` tests; `admin.spec` access matrix; `security-review.spec` |
| **IDOR / privilege escalation** | Object-level checks answer 404/403 for strangers and other organizers; anonymous gets 401 | `security-review.spec`: a stranger, another organizer and anonymous are refused on **13 read and 19 write endpoints** of one team event (team, submission, versions, file, scorecard, registrations, results, certificates, PDF...); a member cannot lead; nothing changed afterwards |
| Administrator functions | Every admin service starts with an admin check; participants, organizers and judges get 403 from 23 entry points | `admin.test` and `admin.spec` |
| CSRF / Origin | Origin or Sec-Fetch-Site check on every state-changing request, JSON or multipart only | `auth.spec`, `teams-judging.spec`, `admin.spec` (forged origin refused even with an administrator session) |
| Rate limiting | Login, registration, reset, resend, token submit, change-password, MFA, invites, uploads, registration, verification endpoint | unit (`auth-service`, `events`) and e2e (429 and `Retry-After`) |
| Sessions | HttpOnly, SameSite=Lax, server-side, revoked on logout/reset/password change/suspension/role change | unit and e2e |
| Password management | Reset, change (current password needed, all devices signed out) | unit and e2e |
| MFA and recovery codes | RFC 6238 vectors, replay protection, one-time recovery codes, optional and never mandatory | `hardening` and `hardening.spec` |
| **File upload security** | Extension + MIME + magic bytes, size/count limits, generated keys, path-traversal-proof storage, private downloads (attachment, nosniff, sandbox CSP), 10 MB limit before reading the body | `submissions.test` (validation, storage), `teams-judging.spec` (privacy, hygiene), `admin.test` (photos) |
| **SQL injection** | All queries are parameterized (Prisma, tagged raw SQL); hostile search strings are inert | `admin.test` (hostile search), `security-review.spec` (SQL-looking input in every search) |
| **XSS** | No raw HTML anywhere; React encoding; free-text fields reject `<` and `>`; links must be https; emails escape user text | `security-review.spec` (3 payloads in 11 inputs, all 400, nothing stored), encoding test, `auth-security-units` (email escaping) |
| CSP | Same-origin policy; external script blocked; no violations on real flows in three browser engines | `hardening.spec`, `cross-browser.spec` |
| Open redirects | `safeNextPath` allows only same-site paths | `auth.spec` |
| **Secret exposure** | `.env` untracked, no tokens or real `.env` values in tracked files, no secret values or connection strings in the built browser bundles, admin settings API shows only whether secrets exist | `secrets.test` (3 tests), `admin.spec` |
| Error handling | No stack traces, SQL or paths in error responses | `security-review.spec` |
| Audit logging | Security and administrative actions recorded; secrets redacted at write and hidden again at display | `admin.test`, `admin.spec` (a seeded token value never appears) |
| Data privacy | Public pages expose no emails; judges never see author names; results hide judges; photos private until published; participant list audited | `teams-judging.spec`, `judging.test`, `admin.spec` |

## Residual risks and recommendations

1. Obtain an independent review and penetration test (C6). 2. Move to a nonce/hash CSP when feasible. 3. Add upload malware scanning before accepting files from the public. 4. Add dependency and secret scanning to CI and pin container images. 5. Put the application behind a WAF or the platform's DDoS protection once hosted; the application's rate limits are per account and per trusted IP only. 6. Review session lifetimes and a shorter administrator policy. 7. Plan key rotation for `AUTH_SECRET` (it also protects stored TOTP secrets).
