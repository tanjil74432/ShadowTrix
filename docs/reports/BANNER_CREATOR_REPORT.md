# Banner Creator redesign

Scope: the personal banner (`/dashboard/banner`, `/admin/leadership/banner`) only. No change to email, authentication, RBAC, administrator permissions, database schema or roles. The approved logo file is untouched (`public/brand/logo-mark.png` is drawn as it is).

## What changed

- **Six templates** (`src/lib/banner/templates.ts`): Founder, Co-Founder, Organizer, Participant, Team member, Judge. Each has its own role badge, frame (double, brackets, notch, solid), background motif (halo, diagonal, grid, network, scan lines) and light position. Colours are the brand palette only.
- **Which templates a person sees is decided on the server from real records** (`src/lib/banner/eligibility.ts`, `banner.service.ts`): Founder / Co-Founder need an approved current position with that title; Organizer needs an organizer role, an event organizer assignment or an approved organizer position; Judge needs a judge role or an event judge assignment; Team member needs a verified active organization member or a competition team; Participant is always offered. Nothing typed into the editor can unlock a role template. An administrator is not automatically an organizer.
- **Designation:** unchanged behaviour. Designations come only from approved positions of verified, active, non-placeholder members; no free text. A person without one gets the name only.
- **Event line:** chosen from events the person is genuinely linked to (confirmed registration, competition team, organizer, judge; published events, plus the organizer's own drafts). Up to two lines on the banner.
- **Organization:** "Team EU Shadow", printed under the unchanged logo.
- **Background identity text:** faint rows of `SHADOWTRIX // ROLE // NAME // EVENT // ORGANIZATION`, deterministic for a given input, over the existing matrix of glyphs.
- **Layout:** the portrait frame is 810 x 800 (large photo), the information panel is planned by `planPanel`, which places name (two lines, shrinks to fit), designation, event and tagline and is unit-tested with worst-case inputs so blocks cannot overlap.
- **Editor:** template picker (radio group), event selector, "Reset zoom and position", preview shown first on phones and sticky beside the form on desktop. Existing zoom, left/right, up/down sliders and drag-to-position are kept.
- **Export:** the same function paints the preview and the PNG: always 1080 x 1350, byte-identical to the preview (tested for every template).

## Tests

- Unit (`tests/banner-templates.test.ts`, 16 tests): eligibility rules, template data and brand colours, identity words, panel layout for worst-case text, real-record template and event offers (organizer, judge, registrations, cancelled events, other people's events).
- Browser (`e2e/banner.spec.ts`, 8 tests): sign-in required, role-gated templates for an ordinary person and for a person with every record, each template renders differently and exports exactly the preview at 1080 x 1350, long names, missing designation, mobile and desktop widths with WCAG 2.2 AA checks and no horizontal overflow, administrator member picker.
- Final local run: typecheck, ESLint, `prisma validate` clean; Vitest 29 files / 545 tests passed; Playwright `npm run test:e2e` 147 passed, 7 skipped (existing opt-in captures), 0 failed; `npm audit --omit=dev` 0 vulnerabilities; `next build` succeeded.

## Evidence

`docs/reports/banner-redesign/`: `template-<name>.png` are the exported 1080 x 1350 PNGs of all six templates (synthetic portrait and a test account), `editor-desktop.png` and `editor-mobile.png` are the editor.

## Known limitations

- Pinch-to-zoom and mouse-wheel zoom are not added (sliders and dragging cover positioning, and wheel zoom would hijack page scrolling).
- A banner is a picture drawn in the browser; a determined user can still edit any image. The server decision limits what the editor offers, it does not make the picture an official record.
- Production verification of the deployed editor is in the final section once the deployment is live.
