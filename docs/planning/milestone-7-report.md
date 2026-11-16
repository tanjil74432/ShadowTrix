# Milestone 7: Teams and Project Submission

Built together with Milestone 8 in Combined Work Package 03, on top of the real Milestone 5/6 branch (`feature/milestone-5-6-events-dashboards`). **Local, uncommitted, unmerged, not pushed.** Design: [../architecture/teams-submissions-judging.md](../architecture/teams-submissions-judging.md). API: [../api/teams-submissions-judging-api.md](../api/teams-submissions-judging-api.md).

## Status: done locally, awaiting review

| Requirement | Result |
|---|---|
| Team creation and editing, name, description | Done (leader edits; names unique per event) |
| Leader and member roles | Done (one leader per team, database-enforced) |
| Member invitation, acceptance, rejection, expiry | Done: emailed single-use link, 7 days, explicit POST to answer, dashboard path too |
| Removal and voluntary leaving, disband | Done, with the "registered team keeps its minimum size" rule |
| Team size limits | Event min and max; maximum enforced by a database trigger under a row lock |
| Team registration for eligible events | Done: leader registers the whole team; capacity counts teams; waiting list promotes whole teams |
| Duplicate membership and duplicate registration prevention | Database: unique (event, user) on memberships and on registrations; tested |
| Team lifecycle and status | `ACTIVE` / `DISBANDED` |
| Individual-only vs team events | Event registration mode with team sizes; each flow refused on the wrong kind |
| Concurrency | Tested: 6 simultaneous answers to one invitation (one wins), 6 simultaneous accepts for the last places, 7 simultaneous team registrations for 3 places |
| Submission: title, description, repository and demo links, extra links | Done; https-only links, no credentials, repository host allow-list |
| File attachments | Done: allow-listed type + MIME + magic bytes, size and count limits, generated keys, private storage |
| Deadline, status | `submissionDeadline` or event end; `DRAFT` / `SUBMITTED` / `UNDER_REVIEW` / `SCORED` / `DISQUALIFIED`; locked once judging starts |
| Resubmission and version history | Every submit, resubmit and file change of a submitted project records a version snapshot |
| Ownership checks | Authors (all team members), the event's organizers, assigned judges (submitted work only), administrators; everyone else `404` |
| Audit | Draft created/saved, submitted, resubmitted, file added/removed, disqualified (with reason) |
| Storage | Interface + local driver; see *Storage* in the architecture document. **S3 driver not implemented** |

## Pages and components

`/teams/[teamId]`, `/team-invitations`, team section on `/events/[slug]`, `/events/[slug]/submission`; dashboard sections for invitations and teams; components: create/edit team forms, invite form, invitation response, submission form, file manager, a generic `ApiButton`.

## Database

Migration `20261117090000_teams_submissions_judging_certificates` (shared with M8): `team_status` enum, team description and status, `team_members.event_id` (backfilled) with unique (event, user) and a composite foreign key, the team-size trigger, one-open-invitation partial unique index, submission `extra_links`/`current_version` with a submitted-at CHECK, `submission_versions`, file `sha256`/`uploaded_by`.

## Tests actually run (this work package)

Vitest: `teams.test.ts` 22, `submissions.test.ts` 22 (including 5 file-validation and 2 storage groups), plus 5 new database-integrity tests. Playwright: team journey, invitation hygiene, submission journey with private files, upload endpoint hygiene, accessibility at 360 and 1440 px. Totals in the M8 report.

## Security notes

Found and fixed during the work: authorization-before-lock was already in place from M5/6; invitation answers are conditional updates (no double accept); a failed join rolls back the whole answer (the invitation stays open); file keys never contain user input; downloads are attachments with `nosniff` and a sandboxing CSP.

## Known limitations

No malware scanning of uploads; ZIP files are stored but never opened by the server; local-disk storage only; no email when a waitlisted team is promoted; times are UTC-only.
