# Milestone 9: Administration and Analytics

Built together with Milestone 10 in Combined Work Package 04 on top of the real, uncommitted M7/M8 code. **Local, uncommitted, unmerged, not pushed.** API: [../api/admin-api.md](../api/admin-api.md).

## Status: done locally, awaiting review

| Requirement | Result |
|---|---|
| User listing, search, details, status, suspend and reactivate, roles, activity history | `/admin/users`, `/admin/users/[id]`: search, roles, suspend/reactivate (sessions end at once), recent activity from the audit log (sensitive values hidden). Existing safeguards kept (no self-demotion, last administrator) |
| Event management: view all, review drafts, cancel or archive, inspect registrations, monitor status, audit | `/admin/events` (filters, counts) and `/admin/events/[id]` (status, organizers, hosts, history); registrations, judging and results through the existing organizer pages, which administrators may open for every event |
| Organizations: create and edit, hosting, profiles, representatives, event relationships, verification | `/admin/organizations`, `/admin/organizations/[id]`: verification records who and when (new columns); representatives hold an organization-scoped role; the operator organization is protected |
| Leadership and teams of ShadowTrix: designations, units, terms and tenure, members, photos, display order, archive, public contact visibility | `/admin/leadership`, `/admin/leadership/members/[id]`; **separate from per-event organizers**. Seeded units and designations only; **no people were invented**. A new member is an unpublished placeholder, and publishing requires marking the details verified |
| Public Our Team page | `/about/team` renders only verified, published members (grouped by unit, ordered by designation seniority, display order, name; former members in an archive; emails only when public; photos only when public). With none, it shows the existing "coming soon" notice |
| Judge and organizer management, assignment history, event-specific access | Organizers: add/remove per event on the event page; judges: existing per-event assignment; history: event audit entries; scoped roles shown on user pages |
| Audit and settings | `/admin/audit` (all, security, administrator actions; filters; secrets hidden), `/admin/settings` (read-only configuration without secrets, signup pause switch). **Event categories are fixed in code** (events, filters and statistics depend on them) and are listed, not editable; result publication is controlled per event (publish/unpublish) |
| Analytics | `/admin/analytics`: users, active participants, events by status and category, registrations (status, individual vs team, per day), organizers, teams, submissions, judging completion, results, certificates; UTC date range (max 366 days); accessible charts (numbers as text); exact-figure tests against an isolated date range |
| No fake metrics, no payments | Every number is a database query; nothing about revenue or payments exists |

## Database

Migrations `20261118090000_admin_and_analytics_support` (organization verification columns, member photo key, indexes `audit_logs(created_at)`, `users(created_at)`, `registrations(registered_at)`; a fourth index was removed by `20261118110000_drop_unused_audit_action_index` because measurement showed it unused) and `20261118100000_org_membership_null_term_unique` (partial unique index closing a duplicate gap found by the tests). All additive.

## Tests actually run

Vitest `admin.test.ts` 18 tests (access refused for non-administrators on 23 entry points, details, filters, organizers, hosts, audit filters, signup pause, organizations, leadership rules and the public team page, photo privacy, hostile search input, analytics figures and ranges); Playwright `admin.spec.ts` 9 tests (access matrix, user management flow, events and organizations, leadership with photos and public page, analytics, audit and settings with secret checks, accessibility at two sizes). Totals in the M10 report.

## Known limitations

Announcements are not built. Platform "configuration" is mostly read-only (deployment values are environment variables by design). Admin lists use offset pagination. The admin interface has no bulk actions and no CSV export. Photo storage is local disk only.
