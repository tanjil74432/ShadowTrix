# ShadowTrix

> Enter the Matrix of Innovation.

ShadowTrix is a centralized platform for organizing, managing, and participating in hackathons, datathons, AI/ML competitions, programming contests, workshops, tech summits, and innovation challenges. Operated by Team EU Shadow.

**Status:** Milestones 1 to 3 complete (M3 CI green on GitHub); Milestone 4 (authentication and authorization) implemented and verified, awaiting review. See the [roadmap](docs/planning/roadmap.md), the [Milestone 4 report](docs/planning/milestone-4-report.md) and the [prepared pull requests](docs/planning/pull-requests.md).

## Brand

The official logo is `assets/branding/1.png` and is never modified. Transparent and favicon derivatives (generated only from that artwork) are in `assets/branding/derived/`; rebuild with `npm run logo:build` in `web/`. Derivatives are for dark backgrounds. Direction: black background, white/silver type, monochrome accents, network/grid motifs.

## Repository layout

```text
ShadowTrix/
├── web/               Next.js full-stack app (frontend, API, business logic, Prisma)
├── docs/              architecture, planning, design, api
├── assets/            branding (original + derived), images, icons
├── scripts/           repository tooling (logo derivative build)
├── tests/             cross-cutting / E2E tests (added with UI milestones)
├── docker-compose.yml local PostgreSQL + Mailpit
└── .github/workflows/ CI
```

## Quick start

```bash
docker compose up -d
cd web && cp .env.example .env     # then set AUTH_SECRET (32+ random characters; see .env.example)
npm install
npm run db:deploy && npm run db:seed
npm run dev          # http://localhost:3010
npm run admin:grant -- you@example.com   # after registering and confirming that account: makes it the first administrator
npm run test:e2e:cross                    # core journeys in Chromium, Firefox and WebKit at phone, tablet and desktop sizes
npm run maintenance:cleanup               # housekeeping (expired sessions/tokens, stale signups); schedule daily
npm run admin:mfa-reset -- you@example.com # break-glass: turn off an administrator's optional two-step verification
```

Details: [web/README.md](web/README.md). Production deployment guide (not yet used): [docs/operations/deployment.md](docs/operations/deployment.md).

## Documentation

- [Technology decisions](docs/architecture/technology-decisions.md) (approved)
- [System architecture](docs/architecture/system-architecture.md)
- [Module boundaries & API conventions](docs/architecture/module-boundaries.md)
- [Database design](docs/architecture/database-design.md)
- [Reference analysis](docs/design/reference-analysis.md)
- [Authentication and authorization](docs/architecture/authentication.md) · [Auth and admin API](docs/api/auth-and-admin-api.md) · [Environment variables](docs/architecture/environment-variables.md)
- [Roadmap](docs/planning/roadmap.md) · [Implementation plan](docs/planning/implementation-plan.md)

## Principles

- No fake data presented as real. Team/leadership profiles are placeholders until verified information is provided; the seed contains no people.
- No secrets in the repository: `.env` is ignored, only `.env.example` is committed.
- A feature is complete only when it works end to end with tests.
- Open-source tooling; no mandatory paid services; deployment-portable configuration.
