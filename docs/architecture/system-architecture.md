# System Architecture

Revised for the approved single Next.js full-stack architecture (see [technology-decisions.md](technology-decisions.md)).

## Overview

```text
Browser ──HTTPS──> Next.js app (one deployable)
                     ├─ Pages / Server Components (SSR + static shell, Suspense for request-time data)
                     ├─ Route handlers  /api/v1/*   (thin)
                     └─ src/server/modules/*        (business logic, extractable)
                              │
                              ├──> PostgreSQL (Prisma)
                              ├──> Storage driver: local disk | S3-compatible
                              └──> SMTP (Nodemailer)
```

Layers, module list and API conventions: [module-boundaries.md](module-boundaries.md). Schema: [database-design.md](database-design.md).

## Frontend routes

Public: `/`, `/events`, `/events/[slug]`, `/about`, `/about/team`, `/about/team/[slug]`, `/community`, `/contact`, `/login`, `/register`, `/verify-email`, `/reset-password`, `/certificates/verify/[code]`.
Authenticated: `/dashboard` (participant), `/organizer/*`, `/judge/*`, `/admin/*`.

Navigation includes **About Us → Our Team**; the homepage carries a compact leadership preview with a "Meet Our Team" link. Empty states (no events, no verified team members) are shown honestly; placeholder profiles display a visible "Placeholder" marker.

## Security model

- Argon2id password hashes; hashed single-use tokens with expiry for verification and reset.
- Session in an httpOnly, Secure, SameSite cookie; CSRF protection on state-changing requests.
- RBAC in services, default deny, plus resource-level checks (team leader edits own team; judges see assigned events; organizers manage their events).
- Zod validation on every input; output shaped explicitly so sensitive fields (password hash, token hashes) never serialize.
- Rate limiting on auth and contact endpoints; security headers (CSP, HSTS, etc.).
- Uploads: allowlisted types, size limits, random storage keys, served with safe content types.
- Member email is exposed only when `email_public = true`.
- Audit log for admin and organizer actions.
- Secrets only via environment; `.env` is git-ignored; `.env.example` is committed; env validation never echoes values.

## Key behaviors

- **Capacity and deadlines** are enforced server-side inside transactions; the UI is advisory.
- **Registration status** is derived from event state and dates: Opens soon, Open, Closed, Full, Live, Ended. Event start/end, registration window, and duration are separate, explicitly labeled fields (avoids the Forkship "5-hour event with a multi-week range" ambiguity).
- **Judging:** weighted criteria per event; final score = weighted average across judges; tie-break rule documented before Milestone 8; results locked on publish.
- **Certificates:** non-guessable public code; public page verifies by code; PDFs regenerable from the record.
- **Health:** `GET /api/health` reports database reachability (200 ok / 503 degraded).

## Non-functional targets

WCAG 2.2 AA; Lighthouse performance and accessibility ≥ 90 on public pages; strict TypeScript; CI blocks on typecheck, lint, test, build, and high-severity production dependency findings.
