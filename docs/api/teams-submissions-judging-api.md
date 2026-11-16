# API Reference: Teams, Submissions, Judging, Results and Certificates (v1)

Base path `/api/v1`. Conventions, error shape, CSRF and rate-limit rules: [auth-and-admin-api.md](auth-and-admin-api.md). Events and registrations: [events-and-dashboards-api.md](events-and-dashboards-api.md). Design and rules: [../architecture/teams-submissions-judging.md](../architecture/teams-submissions-judging.md).

Every endpoint authorizes on the server from the session's database roles. Resources the caller may not see answer `404` (their existence is not revealed); known-but-forbidden actions answer `403`. Malformed ids are `404`. All state-changing requests need an `Origin` header equal to the site origin; JSON endpoints need `Content-Type: application/json`, the upload endpoint needs `multipart/form-data`.

## Teams (team events only)

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `POST /events/{id}/teams` | `{ name, description? }` | `201 { id, name }` | Event must be published, in team mode, not closed or ended. The caller becomes the leader. `409 already_in_team`, `team_name_taken`, `not_a_team_event`, `team_closed`. |
| `GET /teams` | | `200 { items[] }` | The caller's own active teams. |
| `GET /teams/{teamId}` | | `200 team` | Members only (others `404`). Member emails are never included; the leader also sees open invitations. |
| `PATCH /teams/{teamId}` | `{ name?, description? }` | `200` | Leader only. |
| `DELETE /teams/{teamId}` | | `200` | Disband (leader). Frees members, revokes open invitations, cancels the team's registration. `409 team_has_submission` once a project was submitted. |
| `POST /teams/{teamId}/invitations` | `{ email }` | `201 { id }` | Leader only. The answer never reveals whether the address has an account. 20 per hour per team. `409 already_member`, `already_invited`, `team_full` (members plus open invitations may not exceed the maximum). Emails a single-use link valid 7 days. |
| `DELETE /teams/{teamId}/invitations/{invitationId}` | | `200` | Leader revokes an open invitation. |
| `DELETE /teams/{teamId}/members/{userId}` | | `200` | Leader removes a member. `409 team_too_small` if the team is registered and would fall below the minimum. |
| `POST /teams/{teamId}/leave` | | `200` | A member leaves. The leader can leave only a team of one (which disbands it). |
| `POST /teams/{teamId}/registration` | | `201 { status }` / `200` | Leader registers the whole team: `CONFIRMED` or `WAITLISTED`. Capacity counts **teams**. `409 team_size_invalid`, `registration_*`. Idempotent. |
| `DELETE /teams/{teamId}/registration` | | `200 { cancelled }` | Leader cancels; the oldest waiting team is promoted. |
| `GET /me/invitations` | | `200 { items[] }` | Open invitations addressed to the caller's verified email. |
| `POST /team-invitations/preview` | `{ token }` | `200 { teamName, eventTitle, inviterName, ... }` | Only the invited person sees anything; everyone else `404`. |
| `POST /team-invitations/respond` | `{ token, accept }` or `{ id, accept }` | `200 { joined, teamId }` | Only an explicit POST answers (opening the emailed page does nothing). Exactly one answer succeeds, even when sent twice at once; replays, wrong people, expired and answered invitations all return `400 invalid_invitation`. Accepting is refused (and rolled back, so the invitation stays open) when the person is already in another team of the event (`409 already_in_team`) or the team is full (`409 team_full`). |

## Submissions

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /events/{id}/my-submission` | | `200 { submission \| null }` | The caller's own (their team's, for team events). |
| `PUT /events/{id}/my-submission` | `{ title, description, repoUrl?, demoUrl?, extraLinks[] }` | `200 { id, status }` | Saves the private draft. Needs a **confirmed** registration (for team events, through a registered team): `403 not_registered`. `409 submission_closed` after the deadline (`submissionDeadline`, otherwise the event's end), `submission_locked` once judging started, `submission_disqualified`. Links must be `https://`, no embedded credentials; the repository link must be on GitHub, GitLab, Bitbucket or Codeberg. |
| `POST /events/{id}/my-submission/submit` | the same body (optional) | `200 { id, version, status: "SUBMITTED" }` | Submits or resubmits and records a **version**. Needs a title, a description and a link or file (`400 submission_incomplete`). Concurrent resubmissions get consecutive versions. |
| `POST /events/{id}/my-submission/files` | multipart, field `file` | `201 { id, name, mimeType, sizeBytes }` | See *Files*. `411` without a declared length, `413` over 10 MB, `400 invalid_file` with a reason, `409 too_many_files` (5) or `uploads_too_large` (25 MB total). 30 per hour per person. |
| `DELETE /events/{id}/my-submission/files/{fileId}` | | `200` | Same editing rules. A change to a submitted project records a new version. |
| `GET /submissions/{submissionId}` | | `200` | Authors, the event's organizers, administrators, and assigned judges (submitted work only). Everyone else `404`. |
| `GET /submissions/{submissionId}/versions` | | `200 { items[] }` | Authors and organizers (not judges). Each item is a snapshot of title, text, links and file list. |
| `GET /submissions/{submissionId}/files/{fileId}` | | file | Private download, authorized on every request; see *Files*. |
| `GET /events/{id}/submissions` | | `200 { items[] }` | Organizers of the event and administrators. Author names, no emails. |
| `POST /submissions/{submissionId}/disqualify` | `{ reason }` | `200` | Organizers, before results are published. Recorded in the audit log. |

### Files

Allowed: `pdf`, `png`, `jpg`/`jpeg`, `zip`, `txt`, `md`. A file is accepted only if the extension is allowed, the declared MIME type fits the extension, **and** the first bytes match the real format (text files must be UTF-8 without NUL bytes). Names are sanitized for display and never used in a path: files are stored under server-generated keys `submissions/<submission id>/<random id>` (the storage layer refuses anything else, including traversal). Stored content is immutable and private: there is no public URL, so every download goes through the endpoint above, which answers `401`/`404` to anyone not allowed to read the submission and serves `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` and `Cache-Control: private, no-store`.

## Judging

Judges are assigned **per event**. An organizer assigns an existing, confirmed account; this also records an event-scoped `JUDGE` role (never a platform-wide one) and signs that person out once so the role takes effect.

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /events/{id}/criteria` | | `200 { items[] }` | Organizers and assigned judges. |
| `POST /events/{id}/criteria` | `{ name, description?, maxScore, weight?, sortOrder? }` | `201 { id }` | Organizers. `maxScore` 0 to 1000 (2 decimals), `weight` greater than 0 (3 decimals). `409` once any score exists or results are published. |
| `PATCH` / `DELETE /events/{id}/criteria/{criterionId}` | partial | `200` | Same lock. |
| `GET /events/{id}/judges` | | `200 { items[] }` | Organizers: judges with progress. |
| `POST /events/{id}/judges` | `{ email }` | `201` / `200 { judgeId, created }` | `404 judge_not_found` (unknown, unconfirmed or suspended), `409 conflict_of_interest` (the person takes part in the event). |
| `DELETE /events/{id}/judges/{judgeId}` | | `200` | `409` once the judge has entered scores. |
| `GET /events/{id}/judging/submissions` | | `200 { items[] }` | The assigned judge's **anonymous** list (no author or team names, never their own project) with `state`: `NOT_STARTED`, `DRAFT`, `FINAL`. Unassigned callers `404`. |
| `GET /submissions/{submissionId}/scorecard` | | `200 { submission, criteria, scores, finalized }` | Assigned judges only; blind. `403 conflict_of_interest` for an author. |
| `PUT /submissions/{submissionId}/scorecard` | `{ scores: [{ criterionId, score, feedback? }], finalize? }` | `200 { percent, finalized, missing }` | Saves or finalizes. Scores 0..max with at most 2 decimals. `400 score_out_of_range`, `duplicate_criterion`, `unknown_criterion`, `scorecard_incomplete` (finalizing needs every criterion). `409 judging_not_open` (before the submission deadline or `judgingStartsAt`), `judging_closed`, `scorecard_final`, `results_published`, `no_criteria`. The score maximum is enforced again by a database trigger. |
| `POST /submissions/{submissionId}/scorecard/reopen` | `{ judgeId, reason }` | `200` | Organizers, before publication. Audited. |

## Results

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET /events/{id}/results` | | `200 { rows[], missing[], complete, ... }` | Organizers: live standings from finalized scorecards only, with per-judge breakdown and what is missing. |
| `POST /events/{id}/results/recalculate` | | `200` | Rebuilds the **draft** results. Blocked once published. |
| `POST /events/{id}/results/publish` | | `200 { published }` | `409 results_incomplete` unless criteria, judges and submissions exist and **every** submission has a finalized scorecard from **every** assigned judge. Audited with a snapshot of the top results. |
| `POST /events/{id}/results/unpublish` | `{ reason }` | `200` | `409` while valid certificates exist (revoke them first). |
| `GET /events/by-slug/{slug}/results` | | `200 { event, entries[] }` | Public. `404` when not published (indistinguishable from nonexistent). Entries: rank, `tied`, award, score, project title, team or individual name. No judge identities, per-judge scores, feedback or emails. |
| `GET /events/{id}/my-result` | | `200 { result \| null }` | The caller's own published result with per-criterion averages and **anonymous** feedback. |

## Certificates

| Method and path | Body | Success | Notes |
|---|---|---|---|
| `GET` / `PUT /events/{id}/certificate-templates/{type}` | `{ heading, body, signatoryName?, signatoryTitle? }` | `200` | `type`: `PARTICIPATION`, `FINALIST`, `WINNER`. Organizers. The text may use only `{{name}}`, `{{event}}`, `{{team}}`, `{{project}}`, `{{rank}}`. A built-in wording applies until saved. |
| `POST /events/{id}/certificates/issue` | | `200 { issued, alreadyHad }` | Organizers. `409 results_not_published`. One certificate per person per event of the highest type earned: winner (rank 1), finalist (rank 2 to 5), participation (everyone else who submitted). Team results go to every confirmed member. Disqualified submissions earn none. Safe to repeat; a revoked certificate is never silently reissued. |
| `GET /events/{id}/certificates` | | `200 { items[] }` | Issuance history for organizers. |
| `POST /certificates/{certificateId}/revoke` | `{ reason }` | `200` | Organizers. Audited. |
| `GET /certificates/{certificateId}/pdf` | | `application/pdf` | The recipient (while valid; `410 certificate_revoked` afterwards) and the event's organizers. Everyone else `404`. |
| `GET /me/certificates` | | `200 { items[] }` | The caller's own. |
| `GET /certificates/verify/{code}` | | `200 { status: "VALID" \| "REVOKED", recipientName, eventTitle, type, issuedAt }` / `404 { status: "NOT_FOUND" }` | Public, 60 per minute per IP (when the IP is trustworthy). Unknown and malformed codes answer identically. No email or result details. Codes look like `ST-ABCDE-FGHJK-LMNPQ` (15 random characters, 75 bits). |

Pages: `/verify` and `/verify/certificate/{code}` are the human-facing verification pages.
