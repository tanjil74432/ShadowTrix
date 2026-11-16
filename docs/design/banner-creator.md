# Official personal banner creator

One official ShadowTrix template, 1080 × 1350 px PNG (4:5, suited to Facebook). Black and orange, a matrix-inspired digital background, vertical SHADOWTRIX lettering, the member portrait as the main visual, and a dark-orange information panel with name, approved designation, optional tagline and the unchanged official logo.

## Where

| URL | Who | Purpose |
|---|---|---|
| `/dashboard/banner` ("Banner creator" in the account tabs) | any signed-in user | their own banner |
| `/admin/leadership/banner?member=<id>` (link on the Leadership page) | administrators | banner for a verified, active organization member |

## How it works

1. Upload a JPEG, PNG or WebP portrait (up to 12 MB). Photos larger than 2400 px are downscaled in the browser; EXIF orientation is honoured.
2. Crop and reposition with zoom, left/right and up/down sliders, or drag the preview (works with touch).
3. The name is pre-filled (editable, at most 60 characters). Long names shrink, wrap to two lines and are finally shortened with an ellipsis.
4. The designation is a list, not free text.
5. Optional tagline, at most 90 characters.
6. Download PNG.

`src/lib/banner/render.ts` is one pure canvas function used for both the on-screen preview and the export. The preview is the same 1080 × 1350 canvas scaled with CSS, so the download is pixel-identical to what is shown (a test compares the bytes).

## Privacy and security

- The portrait is read, drawn and exported entirely in the browser. It is never uploaded, stored or sent to any service. No new dependency, API endpoint, database table or migration was added; the content-security policy is unchanged.
- **Designations are decided on the server** (`banner.service.ts`) and only offered when they come from a current (not archived) position of a verified (not placeholder), active organization member. A user with no such record gets only their name. Former members and placeholders get none.
- Administrators can open a banner only for verified, active members; placeholders return "not found". Non-administrators get 403 from the service layer.
- The tool never writes data. A banner is a picture: it is not an official record and grants no access or permission (the page says so).
- **Honest limit:** because the image is drawn on the user's own device, someone with developer tools could type any text onto their own local picture. That cannot be prevented without producing the image on the server. What the design guarantees is that the platform never offers or records an unapproved designation, and that nothing on the banner has any effect on the platform.
- The leadership profiles are not invented or published by this feature.

## Tests

- `tests/banner.test.ts` (Vitest, 4): designations only from approved positions; none for ordinary users, placeholders, former members or archived positions; admin-only access for other people; placeholders never listed.
- `e2e/banner.spec.ts` (Playwright, 6): sign-in required; ordinary member has no designation choices; wrong file type refused; long name and tagline; export is exactly 1080 × 1350 and byte-identical to the preview; verified member sees only their approved designation; administrator list excludes placeholders; mobile (390 px) and desktop have no overflow and no axe violations, drag works, export works.

## Not done or not verified

Facebook's own cropping and compression were not tested. No real phone or real photo was used (the tests use a generated 3000 × 2000 test picture). Fonts follow the site's UI font; there is no separate print-quality typeface. Complex scripts (Bangla and others) rely on the user's system fonts in the canvas and were not visually checked.
