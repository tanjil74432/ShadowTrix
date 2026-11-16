# Visual review of the dashboards (Phase A)

Captured from the running application with the Playwright review spec (`UI_REVIEW=1 UI_REVIEW_LABEL=phaseA npx playwright test e2e/ui-review.spec.ts --project=chromium`) against the real development database. The images are in `web/ui-review/phaseA/` and `web/ui-review/banner/`; that folder is git-ignored on purpose because the administration pages show real audit entries (email names) from the development database. Chromium (installed Microsoft Edge) only.

## What was looked at

| Screen | Sizes | Inspected by eye |
|---|---|---|
| Participant dashboard | desktop, tablet, phone captured | desktop viewed in full |
| Organizer dashboard | same | desktop viewed in full |
| Judge area | same | desktop viewed in full |
| Administration overview | same | desktop viewed in full |
| Administration analytics | same | desktop (scrolled, sticky) and tablet viewed in full |
| Sticky navbar while scrolling | desktop, over the analytics charts and the home page | analytics viewed |
| Tablet navigation (820 px) | the full desktop navigation fits; there is no hamburger at this width | closed bar viewed |
| Phone navigation | hamburger and glass dialog (earlier pass, `ui-review/glass/`) | viewed earlier |
| Disabled and focus states | banner creator: disabled crop sliders, disabled designation select, orange focus ring on a text field | field focus and disabled viewed |
| Glass fallback | see below | admin overview viewed |

## Result

The orange and black glass design is consistent across all four dashboards: glass navbar, orange segmented area tabs (participant, organizer, judge) or the glass sidebar (administration), orange-edged KPI cards with orange values, dark-orange tinted panels, orange table headers and row hovers, orange gradient bars, semantic green, amber and red kept for status.

## Inconsistency found and fixed

- **Analytics, "Events by category" showed `Ai ml`** (the database value reformatted) while event cards show "AI/ML Competition". The chart now uses the shared category names (`src/app/admin/analytics/page.tsx`). Data and queries are unchanged.

## Observations, deliberately not changed

- The judge progress bar shows only its empty track when nothing is finalized (0 of 1). That is correct.
- "Published" status pills in the organizer table are neutral; only open, live, full and cancelled carry a colour. This is the intended status semantics.
- On the phone the area tabs scroll sideways (the last tab is partly cut off, the normal scrollable-tab pattern).

## Glass fallback: what was and was not verified

No installed browser lacks `backdrop-filter`. I therefore injected the exact declarations of the `@supports not (backdrop-filter)` block (blur removed, solid dark-orange backgrounds) into a live page and captured the navbar, About menu and administration sidebar (`fallback-admin.png`, `fallback-menu.png`): they stay readable and on-brand. **This verifies how the fallback looks. It does not verify that a real unsupported browser selects it**; that relies on the standard `@supports` rule.

## Not done

Real devices, Safari on Apple hardware, screen readers and a manual keyboard walk-through of every page remain open (unchanged from the quality report).
