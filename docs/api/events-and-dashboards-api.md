# API Reference: Events, Registrations and Profile (v1)

Base path `/api/v1`. Conventions, error shape and CSRF rules are in [auth-and-admin-api.md](auth-and-admin-api.md). Design: [../architecture/events.md](../architecture/events.md).

All authorization is decided on the server from the session's database roles. Nothing the client sends (ids of owners, roles, status, slug) is trusted.

## Public (no login)

| Method and path | Query | Success | Notes |
|---|---|---|---|
| `GET /events` | `q` (max 100), `category` (`HACKATHON`, `DATATHON`, `AI_ML`, `PROGRAMMING_CONTEST`, `WORKSHOP`, `SUMMIT`, `INNOVATION_CHALLENGE`, `OTHER`), `page`, `pageSize` (1 to 50, default 12) | `200 { items[], total, page, pageSize }` | Published events only, ordered by start date. Search is case-insensitive over title and summary and is parameterized. Items include `confirmedCount` and hosting organizations, never organizer emails or creator ids. `400` for an out-of-range parameter. |
| `GET /events/by-slug/{slug}` | | `200 event` | Published and cancelled events (a cancelled event must say so). Drafts and archived events are `404`. |

## Organizers and administrators

An **organizer** manages only events they organize (listed in `event_organizers`); an **administrator** manages all; an **event-scoped ORGANIZER grant** manages exactly one event and cannot create events. A participant, a judge, or the organizer of another event is refused.

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `POST /events` | `title`, `category`, `summary`, `description`, `startsAt`, `endsAt`, `registrationOpensAt`, `registrationClosesAt`; optional `submissionDeadline`, `judgingStartsAt`, `judgingEndsAt`, `resultsAnnouncementAt`, `capacity`, `locationType` (`ONLINE`, `ONSITE`, `HYBRID`), `location`, `eligibility` | `201 { id, slug, status: "DRAFT" }` | `403` before the body is read for people who cannot create events. The event is always a draft owned by the creator; `status`, `slug`, `createdById` and `registrationMode` in the body are ignored. Dates are ISO strings in UTC. Timeline rules (field-level `400`): end after start; registration closes after it opens and not after the event ends; submission deadline not before the start; judging ends after it starts and not before the submission deadline. |
| `GET /events/{id}` | | `200` organizer view | Includes drafts. `404` for a draft the caller does not manage, `403` for a published event they do not manage. |
| `PATCH /events/{id}` | any subset of the create fields | `200 { id, slug, status }` | Cancelled and archived events are `409`. The merged timeline is re-validated (`400 invalid_timeline`). A capacity below the confirmed count is `409`; raising it promotes people from the waiting list. |
| `POST /events/{id}/status` | `{ action: "publish" \| "unpublish" \| "cancel" \| "archive" }` | `200 { id, status }` | Allowed: publish from draft (only while registration has not already closed); unpublish only while nobody is registered; cancel from published; archive from draft, published or cancelled. Anything else `409`. |
| `POST /events/{id}/registration-window` | `{ closed: boolean }` | `200` | Closes or reopens registration by hand, regardless of the dates. Published events only. |
| `GET /events/{id}/registrations` | `page`, `pageSize` (max 100), `status` | `200 { items[{ id, status, registeredAt, user: { id, fullName, email } }], total, counts }` | The only place participant names and emails leave the database. Organizers of this event and administrators only; each call writes a `registration.list_viewed` audit entry. |

## Participants

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `POST /events/{id}/registrations` | none | `201 { status }` new, `200 { status }` already registered | `status` is `CONFIRMED` or `WAITLISTED`. Requires login. Idempotent. Refused with `409` and a code: `registration_not_open_yet`, `registration_closed`, `registration_ended`, `registration_cancelled`, `registration_team_only`. Drafts and archived events are `404`. |
| `DELETE /events/{id}/registrations` | none | `200 { cancelled: boolean }` | Cancels the caller's own registration (until the event ends) and promotes the oldest waitlisted person. Cannot affect anyone else's. |
| `GET /me/registrations` | | `200 { items[] }` | The caller's own registrations with event summaries. |
| `PATCH /me/profile` | `{ fullName, bio? }` | `200 { id, fullName, bio }` | The id comes from the session. Email and roles cannot be changed here; unknown fields are ignored. |

## Capacity and concurrency

Register, cancel and capacity changes lock the event row (`SELECT ... FOR UPDATE`) inside one transaction, so two people racing for the last seat cannot both get it and the confirmed count never exceeds the capacity. Waitlist order is registration time (oldest first). A cancelled registration that registers again reuses its row and goes to the back of the queue.

Malformed ids (not a UUID) return `404`, not `400`.
