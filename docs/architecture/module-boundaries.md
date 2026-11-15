# Module Boundaries

## Layers (single Next.js app)

```text
src/app/**            Pages & route handlers. Thin: parse input (Zod), call a service, shape the response.
src/components/**     UI. Never touches the database.
        │ calls
        ▼
src/server/modules/<module>/
    <module>.service.ts      Business rules, authorization checks, transactions. No Next/React imports.
    <module>.repository.ts   (when needed) Prisma queries only.
    <module>.schema.ts       Zod input/output schemas shared by routes and services.
        │ uses
        ▼
src/server/db/client.ts      Prisma client (the only place the adapter is configured)
src/server/config/env.ts     Validated environment
src/server/http/*            AppError types and apiHandler (uniform error responses)
```

Rules (the first is enforced by ESLint, the rest by review):

1. `src/app` and `src/components` may not import `@/server/db/*`, `@/generated/*`, or Prisma packages.
2. Services never import from `next/*` or React, so a module can be extracted to NestJS unchanged.
3. Modules talk to each other only through exported service functions, not each other's repositories or tables, except for read-only joins documented in the module.
4. Every service function that acts on behalf of a user takes an explicit `actor` (id + roles); authorization is decided in the service, not in the route.
5. Request-time reads (cookies, sessions, DB) in pages sit inside `<Suspense>` or a `use cache` boundary (required by `cacheComponents`).

## Modules

| Module | Owns tables | Depends on | Milestone |
|---|---|---|---|
| health | none | db | 2 (done) |
| auth | users (credentials), auth_tokens, sessions | email, audit, security | 4 (done) |
| authz | none (pure permission matrix) | none | 4 (done) |
| admin (user management) | user_roles (writes), users.status | auth, authz, audit | 4 (done); UI in 9 |
| users | users (profile) | auth, audit | later |
| events | events, event_schedule_items, event_hosts, event_organizers | users, organizations, audit | 5 |
| organizations | organizations | audit | 5 |
| registrations | registrations | events, users, teams | 5 |
| announcements | announcements | events, email | 6 |
| teams | teams, team_members, team_invitations | events, users, email | 7 |
| submissions | submissions, submission_files | events, teams, storage | 7 |
| judging | judging_criteria, judge_assignments, scores | events, submissions | 8 |
| results | results (leaderboard) | judging | 8 |
| certificates | certificates | results, registrations, storage | 8 |
| leadership | org_units, designations, org_terms, org_members, org_memberships, org_member_contributions | storage, audit | 6a |
| admin (dashboard, analytics) | site_settings, audit_logs (read) | all (read), audit | 9 |
| email, audit | (infrastructure) audit_logs write | env | 4 (done) |
| security (rate limit, CSRF, tokens, client IP) | rate_limits | env, db | 4 (done) |
| storage | (infrastructure) | env | 7 |

## API conventions

- REST + JSON under `/api/v1/<resource>`; operational endpoints (`/api/health`) are unversioned.
- Errors: `{ "error": { "code": string, "message": string, "issues"?: [...] } }` with status 400 (validation), 401, 403, 404, 409, 429, 500. Internal details are never returned.
- Auth: HttpOnly session cookie. Every state-changing request is checked centrally in `apiHandler` (Origin / Sec-Fetch-Site must be same-origin; JSON content type for bodies), and every handler declares its permission with `requireApiUser` / `requireApiPermission`. Details: [authentication.md](authentication.md).
- Pagination: `?page=&pageSize=` with a capped `pageSize`; list responses include `total`.
- Dates are ISO 8601 UTC strings; events also carry an IANA `timezone` for display.
- OpenAPI: generated from the Zod schemas (decision deferred to Milestone 5 when the first real resource lands); documents go in `docs/api/`.

## Planned endpoint surface (contract draft)

Authentication and administration endpoints are implemented and documented in [../api/auth-and-admin-api.md](../api/auth-and-admin-api.md) (there is no `/auth/refresh`: sessions are server-side). The rows below are still plans.

| Area | Endpoints |
|---|---|
| Events (public) | `GET /events` (filters: category, status, q, date), `GET /events/{slug}`, `GET /events/{slug}/schedule`, `GET /events/{slug}/leaderboard` |
| Events (organizer) | `POST /events`, `PATCH /events/{id}`, `POST /events/{id}/publish`, `/registration/open`, `/registration/close`, participants list/export, announcements, submissions list |
| Registration | `POST /events/{id}/registrations`, `DELETE /registrations/{id}`, `GET /me/registrations` |
| Teams | `POST /events/{id}/teams`, `POST /teams/{id}/invitations`, `POST /invitations/{token}/accept|reject`, `PATCH /teams/{id}/leader`, `DELETE /teams/{id}/members/{userId}` |
| Submissions | `PUT /events/{id}/submission`, `POST /submissions/{id}/files`, `POST /submissions/{id}/submit` |
| Judging | `GET /judge/events`, `GET /judge/events/{id}/submissions`, `PUT /submissions/{id}/scores`, `POST /events/{id}/results/compute|publish` |
| Certificates | `GET /me/certificates`, `GET /certificates/{publicCode}/pdf`, public page `/certificates/verify/{publicCode}` |
| Leadership (public) | `GET /team` (grouped by unit, ordered), `GET /team/{slug}` — published members only; email only when `emailPublic` |
| Leadership (admin) | CRUD for members, units, designations, terms; photo upload; reorder; archive; promote/remove |
| Admin | users, roles, organizers, judges, analytics, settings, audit logs |
