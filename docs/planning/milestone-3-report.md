# Milestone 3 Report: Design System, Base Components and Homepage

Date: 2026-11-15 · Branch: `feature/milestone-3-design-system`

## 1. Files created and modified

**Created**
- Design tokens and docs: `docs/design/design-system.md`, `docs/design/screenshots/*` (10 images), this report.
- Pages: `src/app/page.tsx` (homepage), placeholder routes `events`, `about`, `about/team`, `community`, `contact`, `login`, `register`, internal `design-system`, plus `robots.ts`, `sitemap.ts`, `manifest.ts`, `opengraph-image.png`, `twitter-image.png` (+ alt text files).
- Components: `ui/` (button, container, section-heading, badge, status-badge, field, skeleton, empty-state, sample-notice, animated-headline, icons), `layout/` (navbar, nav-link, about-menu, mobile-menu, skip-link, brand-logo, footer, coming-soon), `event/` (event-card, category-cover, event-timeline), `profile/profile-card`, `home/` (9 section components).
- Library and content: `lib/{cn,site,event-categories,event-status,format}.ts`, `types/event.ts`, `content/sample-data.ts`.
- Tests: `tests/design-tokens.test.ts`, `tests/event-logic.test.ts`, `e2e/site.spec.ts`, `playwright.config.ts`.
- Database: migration `*_event_timeline_dates`.

**Modified**
- `globals.css` (tokens), `layout.tsx` (fonts, metadata, landmarks), `schema.prisma`, `db-integrity.test.ts`, `eslint.config.mjs`, `package.json`, `.env.example`, `.gitignore`, CI workflow, `scripts/build-logo-assets.mjs` (social card, PWA icons), `reference-analysis.md`, `database-design.md`, `roadmap.md`.

## 2. Design system
See [design-system.md](../design/design-system.md): color, type, spacing, radius, shadow, breakpoints, motion and accessibility rules, with measured contrast ratios.

## 3. Components implemented
Navbar (with Radix dropdown "About Us → Our Team" and Radix dialog mobile menu), footer, buttons (3 variants, 4 sizes), event card, category and status badges (7 states, shape plus text), section heading, profile card, nav links with `aria-current`, loading states (skeleton, spinner), empty state, form elements (Field, Input, Textarea, Select) and an event timeline showing the five distinct phases.

## 4. Homepage
Eleven parts as specified: navigation, hero, featured events, categories (formats and technology-domain groups), how it works, organization introduction, leadership preview, community, previous events, call to action, footer. Official logo from `assets/branding` (transparent derivative of the unmodified artwork). All events, past events and leadership profiles are **sample or placeholder content**, each block with a visible notice and per-item badges.

## 5. Screenshots
In `docs/design/screenshots/`: `home-{mobile-360,tablet-768,laptop-1024,desktop-1440}.png` (full page), `-fold.png` variants (above the fold), and `design-system-{mobile-360,desktop-1440}.png`.

## 6. Responsive testing
Automated at 360, 768, 1024 and 1440 px (Microsoft Edge via Playwright): no horizontal overflow at any size; header switches to the dialog menu below 768 px; touch targets in the mobile header are 44 px; grids reflow 1, 2 and 3 to 4 columns; screenshots reviewed by eye at 360 and 1440 px. Not tested: real phones and tablets, Safari, Firefox.

## 7. Accessibility review
Automated (axe-core, WCAG 2.0 to 2.2 A and AA tags): zero violations on the homepage at 4 breakpoints, with animations enabled after they finish, the open mobile menu, and the design-system page at 2 sizes. Behavior tests: skip link is the first tab stop and moves focus to main; About menu works by keyboard (Enter, arrows, Escape, focus return); mobile dialog traps focus, closes on Escape and returns focus; every checked tab stop has a visible 2px focus outline; `aria-current` on the current page; form errors linked with `aria-describedby`/`aria-invalid`; single H1, no skipped heading levels, landmarks present; images loaded with alt attributes; reduced motion removes animation and shows the hero text immediately; hero headline appears once in the DOM text.
Limits: automated checks catch only part of accessibility issues. No manual screen-reader pass (NVDA, VoiceOver) has been done yet.

## 8. Audit conformance
Each Forkship audit finding is mapped to an implementation and a test in [reference-analysis.md](../design/reference-analysis.md).

## 9. Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | pass |
| ESLint (incl. data-layer boundary rule) | pass |
| Vitest (unit, token contrast, event logic, database integrity) | 44 of 44 pass |
| Playwright e2e (responsive, axe, keyboard, SEO, links, reduced motion) | 24 of 24 pass |
| `next build` (Cache Components) | pass; 20 pages prerendered |
| Prisma drift check | no difference; fresh database applies all 3 migrations |
| `npm audit --omit=dev` | 0 vulnerabilities |

## 10. Known issues and caveats
- **Database change (small, additive):** three nullable timeline columns plus ordering CHECK constraints were needed to show judging and result dates. While generating the migration, Prisma tried to drop my hand-made `org_members_public_idx`; I declared the index in the schema and removed the drop. My local dev database had already applied the uncorrected migration, so I restored the index and updated that migration's checksum in the dev database (Prisma refuses `migrate reset` from an AI agent, and I did not bypass that guard). A fresh database applies cleanly and shows no drift.
- Sample statuses use a fixed reference date (2026-11-15), so the labels stay stable; they are replaced by real data in Milestone 5.
- Links such as `/events?category=hackathon` currently land on a "Not available yet" page; filters arrive with Milestone 5. Placeholder pages are `noindex` and left out of the sitemap.
- Footer year is cached for a day (required by Cache Components).
- Event cover art is generated, not photographic; real cover uploads are supported by the component.
- Lighthouse performance scores were not measured. Cross-browser testing is Edge only locally; CI installs Chromium but has not run, since nothing is pushed there for CI yet beyond the branch.
- `/design-system` is internal: returns 404 unless `ENABLE_STYLEGUIDE=true`.

## 11. Recommended next milestone
Milestone 4: authentication (register, login and logout, email verification, password reset, role-based access), which will turn the Login and Register placeholder pages into real pages using the form components built here. Before that, review this branch's pull request into `develop`, and consider a manual screen-reader pass on the homepage.
