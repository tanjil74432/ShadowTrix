# Banner Creator: one universal template (Option A)

Scope: the personal banner (`/dashboard/banner`, `/admin/leadership/banner`) only. No change to email, authentication, RBAC, administrator permissions, database schema or roles. The approved logo file is untouched (`public/brand/logo-mark.png` is drawn as it is). The server side (`banner.service.ts`) is unchanged: designations still come only from approved positions of verified, active, non-placeholder members.

## Design decisions

1. An early iteration offered six role templates (Founder, Co-Founder, Organizer, Participant, Team member, Judge). It was replaced, on request, by **one universal layout for everybody**. The template picker, role badges and the server-side template/event eligibility code were removed and never merged to `main`.
2. The custom text was first drawn behind the top of the photo. After review, **Option A** was chosen: the identity text is a **large heading above the photo**, with a clear gap, never behind or over it. There is no background removal; the uploaded photo is drawn exactly as uploaded (zoom and position only).

## What the editor does

- **Fixed identity:** vertical SHADOWTRIX wordmark on the left, a large double-framed portrait (810 x 645), an information panel below, black/charcoal background with burnt-orange and silver accents, Matrix glyph columns, grid hairlines, halo rings, network nodes, faint repeating brand text, the unchanged official logo with the "TEAM EU SHADOW" caption.
- **Identity text** (one prominent field): large, bold heading above the photo with a silver-to-orange gradient, an orange halo and a soft orange light behind it. Controls: text, size (60 to 200), left/right, up/down, opacity (0.15 to 1), rotation (-12 to 12 degrees) and "Reset identity text". Default "SHADOW" (decoration, not a role). Upper-cased, limited to 24 characters, never stored.
- **Decoration, not authority:** the identity text is separate from the **verified designation**, which stays its own server-approved select and its own line in the panel. Typing FOUNDER or JUDGE in the identity text creates no designation and gives no access (tested).
- **Information below the photo:** name (always shown), verified designation, university, department, event name, team or organization, tagline. A "Show on banner" tick for each optional item; hidden or empty items leave no gap.
- **Photo:** upload (JPEG, PNG, WebP, up to 12 MB, kept in the browser), zoom, left/right, up/down, drag to reposition, "Reset zoom and position".
- **Preview and export:** one drawing function paints the preview and the PNG. The canvas is always 1080 x 1350; the download is exactly what the canvas holds.

## Layout guarantees (no clipping, no overlap)

- The heading is placed by `planBackgroundText`: the size is reduced until the rotated text fits the heading band (the band above the portrait, lined up with it, 25 px clear of the frame) and the position is limited to that band. It cannot be clipped by the banner edge and cannot touch the photo.
- The information panel is placed by `planPanel`: name up to two lines (shrinks to fit), each other item its own row (secondary rows shrink together, then fall back to one line each), nothing leaves the panel, and no line touches the logo or its caption (reserved space comes from the measured caption width).
- Both are pure functions given a measuring context, so unit tests cover worst-case input (maximum lengths, unbreakable words, every size/rotation/position combination).

## Fixes found while testing

- The brand caption was wider than the space reserved for the logo, so a long university name could run into it. The reservation now uses the measured caption width, with a unit test that was verified to fail when the original bug is recreated.
- The editor loads the four font weights the canvas uses and repaints when fonts finish loading. Each font load tolerates failure: on a machine without the local fallback font (the Linux CI runner), `document.fonts.load` rejects with a NetworkError. A browser test simulates exactly that.
- Raster note: Chromium can rasterise the canvas on the GPU or the CPU (it may switch after repeated pixel read-backs), which moved 57 anti-aliased pixels by 1/255 in one measured case. The browser tests assert what is guaranteed: the downloaded file is byte-identical to the canvas it was exported from, and the same picture as the preview within a 2/255 per-channel tolerance on under 0.05% of pixels. Every other check is exact.

## Tests

- Unit: `tests/banner-layout.test.ts` (14 tests: geometry, the heading band above the frame with a gap of at least 20 px, heading bounds for every size/rotation/position/length including short and 24-character text, opacity and invalid input, panel layout for worst cases including logo and caption clearance, rows follow what is provided) and `tests/banner.test.ts` (4 tests: designations only from approved positions).
- Browser (`e2e/banner.spec.ts`, 10 tests): sign-in required; an ordinary member gets no designation choices and exports exactly 1080 x 1350; a verified member sees only the approved position; administrator picker; no template picker exists; every identity-text control and every "show" tick changes the artwork and resetting restores it; Option A pixel checks (the heading is drawn in the band above the photo and the photo strip is unchanged for "I", "JUDGE", "CO-FOUNDER", "SHADOWTRIX" and a 24-character text; empty text draws no heading); maximum-length input in every field; the editor still works when font loading fails; mobile and desktop widths with WCAG 2.2 AA checks and no horizontal overflow.

## Evidence

`docs/reports/banner-redesign/`: eight exported 1080 x 1350 PNGs downloaded through the real Download button from the running editor (`banner-1-CO-FOUNDER` to `banner-8-stress-long-name-and-every-field`: CO-FOUNDER, FOUNDER, PARTICIPANT, SHADOWTRIX, a 2-letter heading, a 23-character heading, a tilted soft heading, and a long name with every field filled), plus `editor-desktop.png`, `editor-identity-text-controls.png` and `editor-mobile.png`. The photo in them is a synthetic drawing, not a person. The identity-text examples are decorative, not verified designations.

## Known limitations

- No pinch or wheel zoom (sliders and dragging cover positioning; wheel zoom would hijack page scrolling).
- The photo frame is landscape (810 x 645), so very tall portraits are cropped at the top and bottom unless zoomed and positioned.
- Very long identity text shrinks to fit the band, so it is smaller than short text.
- A banner is a picture drawn in the browser. Anyone can edit any image, so it is not an official record; the verified designation only limits what the editor offers.
- Event, university, department and team are free text chosen by the person, by design.

## Final commit and CI

Recorded in the final report of the release.
