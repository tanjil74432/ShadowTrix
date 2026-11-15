# Events, Registration and Dashboards

Milestones 5 and 6. API: [../api/events-and-dashboards-api.md](../api/events-and-dashboards-api.md). Database tables are unchanged from the original design ([database-design.md](database-design.md)); migration `20261116090000_events_registrations_integrity` only adds integrity rules and indexes.

## Module layout

- `src/server/modules/events/event-lifecycle.ts`: pure rules (status transitions, registration window, capacity placement, slugs). No database, no clock.
- `event.schema.ts`: Zod schemas; the timeline rules mirror the database CHECK constraints so people get field-level messages.
- `events.service.ts`: public reads, organizer create/update/status, the organizer dashboard query.
- `registrations.service.ts`: register, cancel, waitlist promotion, participant list.
- `authz/permissions.ts`: `canManageEvent(actor, eventId, organizerIds)` and `canCreateEvents(actor)`, pure and unit-tested.
- Pages and components call services only through the data-access rules enforced by ESLint (`src/server/modules` is the only place that touches the database).

## Event lifecycle

```text
DRAFT --publish--> PUBLISHED --cancel--> CANCELLED
  ^                    |
  +----unpublish-------+ (only while nobody is registered)
DRAFT / PUBLISHED / CANCELLED --archive--> ARCHIVED (terminal)
```

Drafts and archived events do not exist for the public: lists, details and registration answer as if they were absent. A cancelled event keeps a public page that says so. Registration is open only when the event is published, individual-mode, before it ends, between the opening and closing dates, and not closed by hand. Team registration is not available yet (events are created in individual mode); it arrives with the teams milestone.

## Ownership

Creating an event makes the creator its lead organizer (`event_organizers`) and attaches the platform operator organization as host when one exists. An organizer can edit, publish, cancel and see participants of **only** events they organize. Administrators manage every event. An event-scoped `ORGANIZER` role grant covers exactly that event. Someone who cannot manage a draft gets `404` (its existence is not revealed), and `403` for a published event.

## Capacity

Confirmed registrations never exceed `capacity`. Every operation that changes the seat count runs in one transaction that first locks the event row. Extra people are waitlisted and promoted oldest first when a confirmed person cancels or the capacity is raised. Tested with 14 simultaneous registrations for 5 seats and with simultaneous cancellations and registrations.

## Privacy

Public endpoints return event data only (no creator id, no organizers, no registrations). Participant names and emails are returned only by the organizer participant list, which checks authorization itself and writes an audit entry each time. A participant sees only their own registrations. Profile updates always act on the session user.

## Dashboards

- **Participant** (`/dashboard`): registered events with status, upcoming and past, upcoming deadlines (registration close, start, submission deadline) for events they are registered for, cancelled registrations, and `/dashboard/settings` (profile, change password, optional administrator MFA).
- **Organizer** (`/organizer`, `/organizer/events/new`, `/organizer/events/{id}`): list of managed events with registration counts, basic analytics (events, published, confirmed, waitlisted, seats filled), create and edit form, publishing controls, registration list.
- Navigation is role-aware (`AreaNav`): links appear only for areas the user can open, and each page still enforces access on the server. Submission and judging status will be added when those milestones exist; nothing is faked.

## Known limitations

- Times are entered and displayed in UTC only.
- The public event page streams, so unknown or hidden events return HTTP 200 with a not-found view marked `noindex`.
- Event cover images, schedule items, announcements and team registration are not part of this release.
- No email is sent when an event is cancelled or when a waitlisted person is promoted.
- The participant list shows the first 50 registrations on the page; the API pages through all.
- The public sitemap does not list individual events yet.
