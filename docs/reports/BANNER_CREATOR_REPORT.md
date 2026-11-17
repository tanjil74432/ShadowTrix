# Banner Creator: one universal template

Scope: the personal banner (`/dashboard/banner`, `/admin/leadership/banner`) only. No change to email, authentication, RBAC, administrator permissions, database schema or roles. The approved logo file is untouched (`public/brand/logo-mark.png` is drawn as it is). The server side (`banner.service.ts`) is unchanged: designations still come only from approved positions of verified, active, non-placeholder members.

## Design decision

An earlier iteration offered six role templates (Founder, Co-Founder, Organizer, Participant, Team member, Judge). That was replaced, on request, by **one universal layout for everybody**. The template picker, the role badges and the server-side template/event eligibility code were removed (they were never merged to `main`).

## What the editor does

- **Fixed identity:** vertical SHADOWTRIX wordmark on the left, a large double-framed portrait, an information panel below, black/charcoal background with burnt-orange and silver accents, Matrix glyph columns, grid hairlines, halo rings, network nodes, faint repeating brand text, the unchanged official logo with the "TEAM EU SHADOW" caption.
- **Background text** (new, one prominent field): large, soft, partly transparent lettering behind the top of the portrait. Controls: text, size, left/right, up/down, opacity, rotation (-30 to 30 degrees), and "Reset background text". Default "SHADOW" (decoration, not a role). The text is upper-cased, limited to 24 characters, and never stored.
- **Decoration, not authority:** the background text is separate from the **verified designation**, which stays its own server-approved select and its own line in the panel. Typing FOUNDER or JUDGE in the background text creates no designation and gives no access (tested: the designation list does not change).
- **Information below the photo:** name (always shown), verified designation, university, department, event name, team or organization, tagline. A "Show on banner" tick for each optional item; hidden or empty items leave no gap.
- **Photo:** upload (JPEG, PNG, WebP, up to 12 MB, kept in the browser), zoom, left/right, up/down, drag to reposition, "Reset zoom and position".
- **Preview and export:** one drawing function paints the preview and the PNG. The canvas is always 1080 x 1350; the download is exactly what the canvas holds.

## Layout guarantees (no clipping, no overlap)

- The background text is placed by `planBackgroundText`: the size is reduced until the rotated text fits its zone (the band above the portrait, lined up with it and clear of the wordmark) and the position is limited to that zone, so it cannot be clipped by the banner edge.
- The information panel is placed by `planPanel`: name up to two lines (shrinks to fit), each other item its own row (secondary rows shrink together, then fall back to one line each), nothing leaves the panel, and no line touches the logo or its caption. The reserved space comes from the measured caption width.
- Both are pure functions given a measuring context, so unit tests cover worst-case input (maximum lengths, unbreakable words, every size/rotation/position combination).

## Fixes found while testing

- The brand caption was wider than the space reserved for the logo, so a long university name could run into it. The reservation now uses the measured caption width, with a unit test that checks every line against the logo and caption rectangles (verified to fail when the original bug is recreated).
- The editor now loads the four font weights the canvas uses and repaints when fonts finish loading, so the preview cannot stay on a fallback font.
- Raster note: Chromium can rasterise the canvas on the GPU or the CPU (it may switch after repeated pixel read-backs). In one measured case that moved 57 anti-aliased pixels by 1/255. The browser tests therefore assert exactly what is guaranteed: the downloaded file is byte-identical to the canvas it was exported from, and the same picture as the preview within a 2/255 per-channel tolerance on under 0.05% of pixels. Every other check is exact.

## Tests

- Unit: `tests/banner-layout.test.ts` (13 tests: geometry, background text bounds for every size/rotation/position/length, opacity and invalid input, panel layout for worst cases including logo and caption clearance, rows follow what is provided) and the existing `tests/banner.test.ts` (4 tests: designations only from approved positions).
- Browser (`e2e/banner.spec.ts`, 8 tests): sign-in required; an ordinary member gets no designation choices and exports exactly 1080 x 1350; a verified member sees only the approved position; administrator picker; no template picker exists; every background control and every "show" tick changes the artwork and resetting restores it; maximum-length input in every field; mobile and desktop widths with WCAG 2.2 AA checks and no horizontal overflow.

## Evidence

`docs/reports/banner-redesign/`: `banner-1-participant.png`, `banner-2-team-member.png`, `banner-3-judge.png` (exported 1080 x 1350 PNGs: the same layout with different background text, size, position, opacity, rotation and information), `editor-desktop.png`, `editor-mobile.png`.

## Known limitations

- No pinch or wheel zoom (sliders and dragging cover positioning; wheel zoom would hijack page scrolling).
- A banner is a picture drawn in the browser. Anyone can edit any image, so it is not an official record; the verified designation only limits what the editor offers.
- Event, university, department and team are free text chosen by the person, by design.

## Final commit and CI

Recorded at the end of the work, once the deployment is verified.
