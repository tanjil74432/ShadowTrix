# Milestone 8: Judging, Results, Leaderboard and Certificates

Built together with Milestone 7 (Combined Work Package 03). **Local, uncommitted, unmerged, not pushed.** Design and the scoring formula: [../architecture/teams-submissions-judging.md](../architecture/teams-submissions-judging.md). API: [../api/teams-submissions-judging-api.md](../api/teams-submissions-judging-api.md).

## Status: done locally, awaiting review

| Requirement | Result |
|---|---|
| Judge management and assignment, event-specific permissions | Per event, by organizers; records an event-scoped `JUDGE` role; participants of the event cannot be judges |
| Criteria, weight and maximum | CRUD for organizers; locked once scoring starts or results are published |
| Score submission, written feedback, validation | One scorecard per judge and submission; 0 to max, 2 decimals; feedback per criterion |
| Edit rules before finalization, finalization | Draft until finalized; finalizing needs every criterion; frozen afterwards; organizer can reopen with a reason |
| Restrictions and duplicate protection | Only assigned judges; blind (no author names); never your own project; unique (submission, judge, criterion); advisory lock per scorecard; database trigger for the maximum |
| Documented weighted formula | `P = 100 * sum(W*s/M) / sum(W)`; `F = mean of P over all judges`; see the architecture document |
| Result calculation, rankings, leaderboard, ties | From finalized scorecards only; competition ranking (1, 2, 2, 4), no hidden tie-breaker |
| Draft and published states, organizer management, publication authorization | Recalculate, publish, unpublish (with reason); organizers of the event only |
| Do not publish incomplete results; do not fabricate | Publishing is refused unless every submission has finalized scorecards from every judge; incomplete submissions are listed as missing, never ranked or estimated |
| Public results; participant/team visibility | Public leaderboard (no judge identities, feedback or emails); own result with anonymous feedback |
| Audit | Calculation, publication (with snapshot), unpublication, scores saved/finalized/reopened, judges, criteria |
| Certificate templates | Per event and type, restricted placeholders, built-in defaults |
| Participant or team certificates by event rules | One per person: winner (rank 1), finalist (2 to 5), participation (other submitters); team results to every confirmed member |
| Unique identifiers, PDF (pdf-lib), secure download, public verification, history, revocation | Done; `ST-XXXXX-XXXXX-XXXXX` codes (75 bits); recipient and organizers only; public verify page and API; revocation with reason |
| Only from genuine finalized, authorized results | Issuing requires published results and an organizer of the event |

## Pages and components

`/judge`, `/judge/events/[id]`, `/judge/submissions/[id]` (blind scoring form); organizer `/organizer/events/[id]/judging`, `/submissions/[submissionId]`, `/results` (standings, publication, templates, issuing, history, revocation); public `/events/[slug]/results`, `/verify`, `/verify/certificate/[code]`; dashboard "My certificates". Existing design system, no new colors.

## Also changed

The organizer and judge areas now recognize **event-scoped** roles (an organizer or judge for a single event reaches their area; each resource is still authorized individually). Team events are creatable and editable from the event form.

## Tests and verification actually executed

| Check | Result |
|---|---|
| TypeScript typecheck, ESLint | clean |
| Vitest (unit and database integration, run alone) | **370 of 370 passed** in 16 files, including `judging.test.ts` 28 (formula with hand-computed values, scoring boundaries, concurrency, blind judging, completeness, ties, publication, certificates, PDF) and the extended architecture test (10) |
| Playwright (run alone, after Vitest) | **101 passed, 1 skipped** (opt-in screenshots), including 8 new tests: full judging journey through the UI (criteria, judge assignment, blind scoring with out-of-range and incomplete attempts, publication refusal then success, public leaderboard without private data, own result, certificate verify, PDF download, revocation), an authorization matrix, and axe WCAG 2.2 AA at 360 and 1440 px on every new page |
| Fresh database migration | 8 migrations apply; **drift check exit 0**; 25 CHECK constraints, 2 triggers, all hand-written indexes present |
| Production build | passes (the e2e server builds it) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| GitHub CI | **not run**: nothing was committed or pushed, as instructed |

## Security findings

- Judges cannot be identified from results; authors cannot be identified by judges (tested on the rendered HTML and the API).
- Unpublished results are indistinguishable from nonexistent pages; certificates cannot be issued before publication.
- Certificate codes are 75-bit random; verification answers unknown and malformed codes identically; PDFs are never publicly reachable.
- Removing a judge who has scored, and changing criteria after scoring, are refused so that finalized scores can never be silently invalidated.
- Open: no upload malware scanning; no independent review.

## Known limitations

See the architecture document. The most important: non-Latin characters in a recipient's name print as `?` on the PDF; S3 storage is not implemented; certificate types are derived from rank only; no emails on judging or publication events.
