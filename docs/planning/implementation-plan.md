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

## Milestone 4 — Authentication

Endpoints: register, verify-email, login, refresh, logout, forgot-password, reset-password, me. Rate limits, lockout/backoff, generic error messages to prevent account enumeration. Tests for expired/reused tokens, role escalation attempts, CSRF.

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
