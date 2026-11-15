# Implementation Plan

## Milestone 2 — Architecture & scaffolding

- pnpm workspace at repo root; `frontend/` (Next.js, TS strict, Tailwind), `backend/` (NestJS, Prisma).
- `docker-compose.yml`: PostgreSQL, Mailpit. `.env.example` for each app.
- Prisma schema from [database-design.md](../architecture/database-design.md); initial migration; seed script producing **clearly labeled placeholder** data only.
- ESLint, Prettier, Husky, GitHub Actions: typecheck, lint, test, build.
- Tests: migration applies to empty DB; health endpoint.

## Milestone 3 — Design system & homepage

- Tokens: `#000000` background, off-white text, silver/gray scale validated for AA contrast; one type scale; 8px spacing grid.
- Components: Button, Link, Nav (with About Us → Our Team), Card, EventCard (title, category, cover, status, dates, deadline, summary, details link), StatusBadge (text+icon), Footer, Container, SkipLink.
- Homepage sections: nav, hero ("Enter the Matrix of Innovation." / "Discover competitions, connect with innovators, and turn your ideas into reality."; CTAs: Explore Events, Join ShadowTrix), featured events, categories (link to filtered Explore), how it works, why participate, community highlights, leadership preview ("Meet Our Team"), past events, CTA, footer.
- Event and member content come from the API; empty states shown honestly when there is no data. No fabricated events.
- Tests: axe checks, visual checks at 360/768/1024/1440, keyboard navigation.

## Milestone 4 — Authentication and authorization (implemented)

Design and security model: [authentication.md](../architecture/authentication.md). API: [auth-and-admin-api.md](../api/auth-and-admin-api.md). Results and limitations: [milestone-4-report.md](milestone-4-report.md).

Delivered as planned: register, verify-email, resend, login, logout, forgot-password, reset-password, me; server-side sessions; role/permission matrix; admin user API; rate limiting; CSRF; enumeration resistance; tests for expired/reused/concurrent tokens, role escalation and CSRF.

Deviations from the original plan:
- **No `refresh` endpoint.** Sessions are server-side with sliding idle expiry, so there is no refresh token to rotate.
- **Rate limiting is database-backed** (Postgres) instead of an in-memory or Redis limiter, to work across instances without new infrastructure.
- **No lockout or exponential backoff.** Fixed-window rate limits per account and per IP are used; permanent lockout would let an attacker lock real users out.
- **Added** a first-administrator bootstrap command (`npm run admin:grant`), the admin user-management API, a role-gated area for each role, and a stricter "email link only opens a page; a button press consumes it" verification flow.
- **Deferred** (carried to later milestones): change-password for signed-in users, MFA, scheduled cleanup, CSP, periodic session rotation.

## Milestone 5 — Events & registration

Explore with filters (category, status, date, search), event details with schedule, registration flow, waitlist, cancellation. Organizer create/edit/publish, open/close registration.

## Milestone 6 — Dashboards

Participant: upcoming events, registrations, announcements, history. Organizer: manage events, participants, announcements, submissions.

## Milestone 6a — Organization module

Public: `/about/team` (hierarchy: Founder → Executive Board → other teams, each with consistent profile cards, responsive grid, subtle hover), `/about/team/[slug]` (photo, name, designation, bio, responsibilities, skills, social links, previous events, contributions). Former members in an "Alumni" section.
Admin: add/edit members, upload/replace photo (validated, resized), assign designation, move between teams, set display order, promote/remove, archive former board members, manage terms, create custom teams/designations. Email shown only if `email_public`. Placeholder members show a visible "Placeholder profile" marker; publishing a profile requires clearing the flag.

## Milestones 7–10

Per [roadmap.md](roadmap.md): teams/invitations and submissions; judging, leaderboard, certificates; admin dashboard, analytics, audit logs; security review, performance, deployment documentation.

## Definition of done (every milestone)

Typecheck, lint, and tests pass; no secrets committed; docs updated; accessibility checked; behavior verified in a running app, not just in code.
