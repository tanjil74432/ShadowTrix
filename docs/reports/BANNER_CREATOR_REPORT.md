# Banner Creator: Classic template for everyone, Matrix template for administrators

Scope: the personal banner (`/dashboard/banner`, `/admin/leadership/banner`) only. No change to email, authentication, roles, role assignments, the Admin Panel's own permissions or the database schema. The approved logo file is untouched. The verified-designation rules (`banner.service.ts`) are unchanged: designations still come only from approved positions of verified, active, non-placeholder members.

## Templates

The banner has exactly two templates. There are no Founder, Co-Founder, Organizer, Participant or Judge templates (an early six-template iteration was removed and never merged).

| Template | Who | Notes |
|---|---|---|
| **ShadowTrix Classic** | every signed-in user | The default. Heading (identity text) above the photo, vertical SHADOWTRIX wordmark, framed photo, information panel. |
| **ShadowTrix Matrix** | administrators only | Premium Matrix-inspired design: deep black base, fine grid, circuit traces, code-glyph rain, large decorative text behind the top of the photo, neon chamfered photo frame, chamfered information card. |

The identity text is decoration in both templates. It is separate from the verified designation, never stored, and grants nothing.

## Authorization model (server side)

The banner is drawn in the browser, so the photo never leaves the device. That means there is no server step that produces the picture, and hiding a selector would protect nothing. The Matrix gate therefore works on **who receives and may use the Matrix drawing code**:

- **Who:** administrators = holders of the existing global `admin:access` permission (an event-scoped or organization-scoped administrator grant is not enough, exactly as for the Admin Panel). No role or permission was added or changed.
- **The page** (`/dashboard/banner`, `/admin/leadership/banner`) asks the server which templates the signed-in person may use (`availableTemplates`) and only receives that list. For everybody else the list is `[Classic]`, so no template choice is rendered and nothing about Matrix is in the HTML.
- **The drawing code** lives only in server code (`src/server/modules/banner/matrix-renderer.ts`). It is delivered as an ES module by `GET /api/v1/banner/templates/matrix/renderer`, which requires `admin:access` on every request. It is not in any public JavaScript chunk (checked in the production build: no chunk contains the renderer; a browser test scans every script a participant's page downloads).
- **Export:** before exporting Matrix, the editor calls `GET /api/v1/banner/template-access?template=matrix`; if the server refuses, no file is produced (for example when the role was removed while the page was open).

| Endpoint | Anonymous | Participant / organizer / judge | Event-scoped administrator | Administrator |
|---|---|---|---|---|
| `GET /api/v1/banner/templates` | 401 | 200, `[classic]` only | 200, `[classic]` only | 200, `[classic, matrix]` |
| `GET /api/v1/banner/templates/matrix/renderer` | 401 | 403 (no code in the body) | 403 | 200, `text/javascript`, `Cache-Control: private, no-store` |
| `GET /api/v1/banner/template-access?template=classic` | 401 | 200 | 200 | 200 |
| `GET /api/v1/banner/template-access?template=matrix` | 401 | 403 | 403 | 200 |
| `GET /api/v1/banner/template-access?template=<anything else>` | 401 | 400 | 400 | 400 |

**What this does and does not guarantee.** Because the picture is drawn client-side, nobody can be technically prevented from re-implementing a Matrix-looking design in their own browser, just as anyone can edit any image. What is enforced is that the ShadowTrix Matrix design itself (its code and its selector) is never delivered to, listed for or exportable by anybody who is not an administrator, and that this is re-checked on every request. A banner is a picture; it is not an official record.

## Fixed preview layout (desktop)

On screens at least 1024 px wide and 640 px tall the editor fills the viewport: the left form scrolls by itself, the preview stays in place, the page itself does not scroll (the footer is hidden on this one screen), and the preview is sized from the free height and width at the exact 4:5 shape, below the navigation header, never stretched. Smaller or shorter screens use the normal stacked page (preview first), which scrolls as usual. The admin member-banner page keeps a sticky preview that is limited to the viewport height.

## Information panel

The panel adapts to what is shown. Rows exist only for fields that are shown and non-empty (no reserved empty rows). Typography is laid out at the largest scale that fits (1.7x down to 0.6x): a banner with only a name, or a name and one or two details, gets large, prominent type (a lone name may use three lines); a full banner stays compact and readable (secondary rows shrink together, then fall back to one line each). The finished block is centred in the panel. Nothing overlaps or leaves the panel, and no line touches the logo or the TEAM EU SHADOW caption.

## Photo frame

The portrait frame, the identity-text band and the panel share one column that is now 750 px wide (was 810), centred between the vertical rule and the right edge with 80 px on each side. The frame height (645) is unchanged. Crop, zoom, position and reset are unchanged; the photo is never stretched.

## Tests

- Unit (vitest): `tests/banner-templates.test.ts` (11 tests: registry; `canUseMatrix`, `availableTemplates` and `assertTemplateAllowed` for participant, organizer, judge, event-scoped and organization-scoped administrator, administrator, anonymous and tampered names; the delivered renderer module runs from its source text alone in a fresh JavaScript context, draws the whole design, tolerates invalid input, and contains no environment or network access); `tests/banner-layout.test.ts` (20 tests: narrower centred frame, heading band, worst-case panel layouts, logo and caption clearance, dynamic scaling and centring, no reserved rows) and `tests/banner.test.ts` (4 tests: designations from approved positions only).
- Browser (`e2e/banner-templates.spec.ts`, 16 tests): every operation over real HTTP for anonymous, participant, organizer, judge, event-scoped administrator and administrator (including tampered parameters and a role removed mid-session); a participant sees no choice and no Matrix text, cannot load the renderer, and downloads no Matrix code; an administrator sees both templates, Classic is the default, Matrix renders and exports exactly the canvas at 1080 x 1350, and Classic returns unchanged; export is refused after the role is removed; accessibility (WCAG 2.2 AA, keyboard arrows) for the template choice; the fixed preview at 1440x900, 1920x1080, 1366x768, 1280x720 and 1024x768 (no page scroll, whole banner visible, 4:5, form scrolls alone, wheel does not scroll the page, larger window gives a larger preview) and the phone layout.
- Browser (`e2e/banner.spec.ts`, 10 tests): the existing Classic behaviour (identity-text controls, show toggles, designation rules, heading above the photo, font-failure resilience, mobile and desktop accessibility).

## Evidence

`docs/reports/banner-templates/`: exported 1080 x 1350 PNGs downloaded through the real Download button from the running editor: information-panel cases (`panel-1-name-only`, `panel-3-name-university-department`, `panel-4-all-fields`, `panel-5-long-name-and-university`), `admin-classic`, and four Matrix banners (`matrix-1-FOUNDER`, `matrix-2-CO-FOUNDER`, `matrix-5-name-only`, `matrix-6-stress-long-text`); plus screenshots of the fixed layout (`layout-1440x900`, `layout-1280x720`, `layout-390x844`) and of the administrator's editor with both templates (`admin-matrix-fit-1440x900`). The photo in them is a synthetic drawing, not a person.

## Known limitations

- The reference image mentioned for the Matrix design was not attached, so Matrix follows the written direction (black and burnt orange, grid, circuit patterns, large type behind the portrait area, neon frame, polished lower card). Colours stay in the ShadowTrix palette.
- Social links are not shown: the user data model has no validated social-link fields, and none were invented.
- The Matrix identity text sits partly behind the photo frame (as asked for Matrix), so the lower part of the letters is hidden by design; Classic keeps its heading fully above the photo.
- No pinch or wheel zoom for the photo (sliders and dragging cover positioning).
- The photo frame is landscape, so very tall portraits are cropped unless zoomed and positioned.
- The footer is hidden on the banner page on large screens (the page does not scroll there).
- A banner is a picture drawn in the browser; anyone can edit any image. See "What this does and does not guarantee".

## Final commit and CI

Recorded in the final report of the release.
