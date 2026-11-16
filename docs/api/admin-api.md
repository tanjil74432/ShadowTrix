# API Reference: Administration and Analytics (v1)

Base path `/api/v1/admin`. Conventions, error shape, CSRF and rate-limit rules: [auth-and-admin-api.md](auth-and-admin-api.md). **Every endpoint requires a platform administrator** (global `ADMIN` role): anonymous callers get `401`, everyone else `403`, and each service function repeats the check, so no page, script or other caller can bypass it. Responses never contain passwords, hashes, tokens or secrets. Every change is recorded in the audit log (`admin.*` actions).

The administrator interface is at `/admin` (overview, users, events, organizations, leadership, analytics, audit and security, settings). It uses only these endpoints and the existing user, event and role endpoints.

## Users

Existing endpoints (see [auth-and-admin-api.md](auth-and-admin-api.md)): `GET /admin/users`, `POST /admin/users/{id}/roles`, `DELETE /admin/users/{id}/roles/{role}`, `PATCH /admin/users/{id}/status`. Safeguards: no self-demotion, no removing the last administrator, no self-suspension; a role change or suspension ends the person's sessions.

| Method and path | Success | Notes |
|---|---|---|
| `GET /users/{id}` | `200 { id, email, fullName, status, roles[], mfaEnabled, counts, activity[] }` | `activity` is the person's recent audit entries (their own actions and administrators' actions on them); values of sensitive-looking fields show as `[hidden]`. |

## Events

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /events` | query `q`, `status`, `category`, `page`, `pageSize` (max 100) | `200 { items[], total, page, pageSize }` | Every event, drafts included, with registration counts, team and submission counts, organizers and hosts. |
| `POST /events/{id}/organizers` | `{ email }` | `201`/`200 { userId, created }` | An existing, confirmed account. Records an event-scoped `ORGANIZER` role and ends that person's sessions once. `404 user_not_found`. |
| `DELETE /events/{id}/organizers/{userId}` | | `200` | `409` for the last organizer of an event. |
| `POST /events/{id}/hosts` | `{ organizationId, role }` (`HOST`, `CO_HOST`, `PARTNER`) | `201` | Sets or changes the role. |
| `DELETE /events/{id}/hosts/{organizationId}` | | `200` | |

Cancelling, archiving, editing and the participant list use the organizer endpoints (`POST /events/{id}/status`, `PATCH /events/{id}`, `GET /events/{id}/registrations`); administrators pass the ownership check for every event. Result publication and unpublication use `POST /events/{id}/results/publish|unpublish`.

## Organizations

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /organizations`, `GET /organizations/{id}` | | `200` | Detail includes hosted events and representatives. |
| `POST /organizations` | `{ name, type?, description?, websiteUrl? }` | `201 { id, slug }` | The platform operator type cannot be created again. Website must be `https://`. |
| `PATCH /organizations/{id}` | partial | `200` | The operator organization's type is fixed. |
| `DELETE /organizations/{id}` | | `200` | `409` for the operator and for organizations that host events. |
| `POST /organizations/{id}/verify` | `{ verified: boolean }` | `200` | Records who verified it and when. |
| `POST /organizations/{id}/representatives` | `{ email }` | `201`/`200` | An organization-scoped `ORGANIZER` role. |
| `DELETE /organizations/{id}/representatives/{userId}` | | `200` | |

## Leadership of ShadowTrix (separate from per-event organizers)

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /leadership` | | `200 { units[], designations[], terms[] }` | |
| `POST /leadership/units` | `{ name, displayOrder? }` | `201` | |
| `POST /leadership/designations` | `{ title, rankOrder? }` | `201` | Lower `rankOrder` is more senior. |
| `POST /leadership/terms` | `{ label, startsOn, endsOn?, isCurrent? }` | `201` | At most one current term (setting one clears the others). |
| `PATCH /leadership/terms/{id}` | partial | `200` | |
| `GET /members`, `POST /members` | query `q`, `unitId`, `status` / member fields | `200` / `201` | New members start as **unpublished placeholders**. |
| `GET`, `PATCH`, `DELETE /members/{id}` | | | `409 placeholder_not_publishable` when publishing a placeholder. Delete also removes the stored photo. |
| `POST /members/{id}/memberships` | `{ unitId, designationId, termId?, startedOn?, endedOn?, displayOrder }` | `201` | `409 membership_exists` for a duplicate (also without a term). |
| `PATCH`, `DELETE /memberships/{id}` | partial incl. `isArchived` | `200` | Archiving keeps the history and records an end date. |
| `POST /members/{id}/photo` | multipart field `file` | `201` | PNG or JPEG up to 2 MB, validated like every upload. `DELETE` removes it. |

Public side: `GET /api/v1/org-members/{id}/photo` serves a photo only for a **verified (not placeholder) and published** member (administrators can always see it); the public page `/about/team` shows only such members, grouped by unit and ordered by designation seniority, display order and name, with former members in an archive section. An email appears only when the member's "public contact" flag is on. No people are pre-filled: with no verified, published profiles the page says the team is coming soon.

## Audit, analytics and settings

| Method and path | Query / body | Success | Notes |
|---|---|---|---|
| `GET /audit` | `view` (`all`, `security`, `admin`), `action` (prefix), `entityType`, `actor` (name or email), `from`, `to` (`YYYY-MM-DD`), `page`, `pageSize` (max 100) | `200 { items[], total }` | `security` shows authentication, MFA, role, status and maintenance events. |
| `GET /analytics` | `from`, `to` (`YYYY-MM-DD`, at most 366 days; default last 30 days) | `200` | Counts computed from the database: users (total, verified, suspended, new in range, active participants, by role), events (by status, by category), registrations (by status in range, individual vs team, per day), organizers, teams, submissions, judging completion, results published, certificates. `400 invalid_range` for reversed or over-long ranges. |
| `GET /settings` | | `200` | Read-only configuration. **Never includes secrets** (only whether SMTP credentials and the cleanup secret are configured). |
| `PATCH /settings` | `{ signupsEnabled: boolean }` | `200` | Pause or resume new account registration (`503 signups_paused` for registrants while paused; existing accounts are unaffected). Audited. |
