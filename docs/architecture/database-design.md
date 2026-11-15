# Database Design (PostgreSQL 17 via Prisma 7)

Source of truth: [`web/prisma/schema.prisma`](../../web/prisma/schema.prisma) plus the hand-written integrity migration `web/prisma/migrations/*_integrity_checks`. Status: **v1.0, applied and tested** (Milestone 2).

Conventions: UUIDv7 ids; `created_at`/`updated_at` as `timestamptz`; snake_case tables; enums as PostgreSQL enums; foreign keys everywhere with explicit delete behavior (CASCADE for owned children, RESTRICT where history must survive, SET NULL for optional links).

## Tables by module

**Identity & access:** `users`, `user_roles` (role grants, optionally scoped to an event or organization), `auth_tokens` (SHA-256 hashes of verification / reset / refresh tokens, never raw tokens), `audit_logs`, `site_settings`.

**Organizations (hosts):** `organizations` (one row flagged `is_operator` = Team EU Shadow), `event_hosts` (HOST / CO_HOST / PARTNER). Prepares for external universities and communities without tenancy.

**Events & organizers:** `events`, `event_organizers` (users who run an event, with `is_lead`), `event_schedule_items`, `announcements`.

**Participants:** `registrations` (one per user per event), `teams`, `team_members` (LEADER/MEMBER), `team_invitations`.

**Submissions & judging:** `submissions`, `submission_files`, `judging_criteria`, `judge_assignments`, `scores`, `results`.

**Certificates:** `certificates` (non-guessable `public_code`, recipient name snapshot, `revoked_at`).

**Leadership / Our Team:** `org_units` (Executive Board, Core Team, … and custom), `designations` (Founder … custom, ordered by `rank_order`), `org_terms`, `org_members`, `org_memberships` (member × unit × designation × term, with `display_order` and `is_archived`), `org_member_contributions`.

## Module review (what was checked and what changed from draft v0.1)

| Module | Requirement | Result |
|---|---|---|
| Leadership Board | Configurable positions, hierarchy, display order, terms, archive | `designations.rank_order` drives hierarchy; `org_memberships` keeps history across terms; archive via `is_archived` + `ended_on`; one current term enforced by partial unique index |
| Core Team / departments | Custom teams, move members between teams | `org_units` is admin-editable; moving = new/updated `org_memberships` row. Renamed from draft "org_teams" to avoid confusion with participant `teams` |
| Member privacy & honesty | No invented people; email only if approved | `is_placeholder` defaults true; `visibility` defaults DRAFT; `email_public` defaults false. Seed contains no people |
| Event Organizers | Organizers per event; future external hosts | `event_organizers` + `organizations`/`event_hosts` (new). Single operator enforced; **no tenancy** |
| Participants | One registration per event, capacity, waitlist | Unique (event, user); statuses incl. WAITLISTED; capacity > 0 CHECK. Capacity enforcement happens in the registration service under a transaction lock (database alone cannot count rows) |
| Teams | One leader, invitations | Exactly one LEADER per team (partial unique index); invitations store hashed tokens, expiry and status |
| Submissions | One per team, one per owner per event | `team_id` unique; (event, owner) unique |
| Judges | Assignment, criteria, scoring, feedback | `judge_assignments`; `scores` unique per (submission, judge, criterion); score ≥ 0 CHECK and score ≤ criterion max via trigger |
| Results | Ranking, awards | `results` with rank ≥ 1 CHECK, award enum, `published_at` |
| Certificates | Unique IDs, verification, revocation | Unique `public_code`; unique (event, user, type); recipient name snapshot so later profile edits don't alter issued certificates |
| Roles | RBAC incl. scoped roles | Dropped the `roles` lookup table in favor of an enum plus scoped `user_roles`. NULL-scope uniqueness is enforced with three partial unique indexes (Postgres treats NULLs as distinct) |
| Auditability | Admin/organizer actions | `audit_logs` with before/after JSON |

## Integrity rules enforced by the database (and tested)

CHECK constraints: lower-case emails; event `ends_at > starts_at`; registration window within the event; submission deadline ≥ start; capacity > 0; team events require `min_team_size ≥ 1` and `max ≥ min`; criteria max/weight > 0; scores ≥ 0; results/rank ranges; file size ≥ 0; membership/term date order.
Trigger: a score may not exceed its criterion's `max_score`.
Partial unique indexes: single operator organization; single current term; single team leader; scoped role grants.
All are exercised by `web/tests/db-integrity.test.ts`, which asserts the specific constraint that fires.

## Known gaps (deliberately deferred)

1. **One team per user per event** is not a database constraint (it needs `event_id` on `team_members`). Planned for Milestone 7 together with the team service.
2. **Judge conflict-of-interest** (judge cannot score their own team) is a service rule to be added in Milestone 8.
3. **Announcement read-state / notifications** not modeled yet; add with the participant dashboard (Milestone 6).
4. **Certificate templates / branding options** are not modeled; certificates start with one built-in layout.
5. **Soft deletes** are not used; history is preserved through status fields and RESTRICT foreign keys. Revisit if admins need restore.
6. File scanning (malware) and image processing metadata for uploads are Milestone 7 concerns.
