# ShadowTrix Design System

Source of truth: [`web/src/app/globals.css`](../../web/src/app/globals.css) (tokens) and `web/src/components/` (components). A live reference page renders every component: `/design-system` (hidden unless `ENABLE_STYLEGUIDE=true`, never indexed).

Direction: near-black base, silver type, one premium orange accent reserved for primary actions, the active navigation item, focus, selection and the open/active status; grid and orbital motifs taken from the logo. No neon, no heavy gradients or glow (one faint orange glow behind the hero logo), no glassmorphism. The logo file is never modified.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#090909` | Page background |
| `surface` | `#141414` | Alternate section background, cards, footer |
| `surface-raised` | `#1c1c1c` | Cards on `surface`, inputs, menus |
| `border` | `#303030` | Hairlines, dividers |
| `border-strong` | `#474747` | Outlined buttons, badges |
| `field-border` | `#7a7a7a` | Form control boundary |
| `fg` | `#f5f5f5` | Primary text |
| `fg-muted` | `#a3a3a3` | Secondary text |
| `fg-subtle` | `#8f8f8f` | Captions, labels (still AA) |
| `silver` | `#d4d4d4` | Designations, emphasis within muted text |
| `accent` | `#f07832` | Primary actions, active navigation, focus ring, selection, chart bars |
| `accent-soft` | `#ff9a55` | Hover on orange, small orange text accents |
| `accent-deep` | `#d95f1b` | Pressed state |
| `on-accent` | `#090909` | Text on orange fills |
| `accent-wash` | `#29170f` | Opaque dark-orange tint: category badges, date panels, notices, active tabs |
| `success` | `#7ddc9c` | Semantic: confirmed registrations |
| `warning` | `#f2cf63` | Semantic: waiting list, full |
| `danger` | `#ff9a9a` | Errors and cancelled, always with icon and text |

### Verified contrast (WCAG 2.2 AA: 4.5:1 text, 3:1 UI boundaries)

| Pair | Ratio |
|---|---|
| `fg` on `bg` / `surface-raised` | 18.26 / 15.63 |
| `fg-muted` on `bg` / `surface-raised` | 7.89 / 6.76 |
| `fg-subtle` on `bg` / `surface-raised` | 6.16 / 5.27 |
| `accent` on `bg` (orange text, focus ring) | 7.05 / 6.52 |
| `on-accent` on `accent` / hover `accent-soft` | 7.05 / 9.49 |
| `on-accent` on `accent-deep` (pressed) | 5.31 |
| `danger` on `surface-raised` | 8.39 |
| `field-border` on `bg` / `surface-raised` | 4.64 / 3.97 |

`tests/design-tokens.test.ts` parses `globals.css` and fails the build if any required pair drops below its threshold, so editing a token cannot silently break contrast. Axe also checks rendered contrast at four breakpoints.

## Typography

Font: Geist Sans and Geist Mono, self-hosted through the `geist` package (no network fetch at build or runtime). Sentence case throughout; no widely tracked uppercase slogans.

| Utility | Size | Use |
|---|---|---|
| `text-display` | fluid 2.5 to 4.75rem, line-height 1.04 | Homepage H1 only |
| `text-h1` | fluid 2 to 3rem | Page titles, CTA |
| `text-h2` | fluid 1.5 to 2.25rem | Section headings |
| `text-h3` | 1.25rem | Card and step titles |
| `text-body-lg` | 1.125rem | Lead paragraphs |
| `text-base` / `sm` / `xs` | 1 / 0.875 / 0.75rem | Body, secondary, captions |

Rules: one H1 per page; heading levels never skip; use `text-balance` on headings and `text-pretty` on paragraphs.

## Spacing, radius, shadow

- Spacing: Tailwind 4px scale. Section rhythm tokens: `py-section` (5rem), `py-section-lg` (8rem). Page gutters 16px phone, 24px tablet, 32px desktop; max width 80rem (`Container`).
- Radius: `sm` 4px, `md` 8px (buttons, inputs), `lg` 12px (cards), `xl` 16px.
- Shadow: depth on black comes from hairlines. `shadow-card` (1px white at 6%), `shadow-card-hover` (orange hairline plus soft drop), `shadow-overlay` (menus and dialogs).

## Breakpoints

Tailwind defaults: `sm` 640, `md` 768 (header switches to the dialog menu below this), `lg` 1024 (3-column grids), `xl` 1280, `2xl` 1536. Tested at 360, 768, 1024 and 1440.

## Motion guidelines

1. Motion is subtle and purposeful: a one-time reveal of the hero, hover/focus transitions of 150 to 250 ms, a slow zoom on event cover art.
2. Durations: `--duration-fast` 150 ms, `--duration-base` 250 ms, `--duration-slow` 700 ms; easing `ease-out-soft`.
3. No looping animation except the pulse ring on the "Live now" status and loading skeletons.
4. `prefers-reduced-motion: reduce` removes all movement and looping globally (final states still apply), and the hero text is visible immediately. Tested.
5. Animated text exists once in the DOM and works without JavaScript (see `AnimatedHeadline`).

## Accessibility conventions

- Focus: a single 2px orange outline with 3px offset on every focusable element (`:focus-visible`).
- Skip link is the first tab stop; `<main id="main" tabindex="-1">` receives focus.
- Landmarks: `header` (banner), `nav` labelled Primary / Mobile / footer columns, `main`, `footer`.
- Status is never color alone: each status has text plus a distinct shape.
- Touch targets: 44px for primary and icon controls.
- Forms: `Field` wires label, hint and error (`aria-describedby`, `aria-invalid`, `role="alert"`); errors show an icon and text.
- Radix primitives provide menu and dialog behavior: keyboard navigation, focus trap, Escape, and focus return.

## Components

| Component | File | Notes |
|---|---|---|
| Button (`primary`, `secondary`, `ghost`; `sm`, `md`, `lg`, `icon`; `asChild`) | `ui/button.tsx` | Radix Slot so links keep button styling |
| Container, SectionHeading | `ui/container.tsx`, `ui/section-heading.tsx` | Heading level via `as` |
| Badge, CategoryBadge, SampleBadge, PlaceholderBadge | `ui/badge.tsx` | |
| StatusBadge (7 states) | `ui/status-badge.tsx` | Text plus shape glyph |
| Field, Input, Textarea, Select | `ui/field.tsx` | Radix Label |
| Skeleton, Spinner, EventCardSkeleton | `ui/skeleton.tsx` | Skeleton matches card layout |
| EmptyState, SampleNotice | `ui/empty-state.tsx`, `ui/sample-notice.tsx` | |
| AnimatedHeadline | `ui/animated-headline.tsx` | CSS-only, single DOM copy |
| Navbar, NavLink, AboutMenu, MobileMenu, SkipLink, BrandLogo, Footer | `layout/*` | AboutMenu: Radix DropdownMenu; MobileMenu: Radix Dialog |
| EventCard, CategoryCover, EventTimeline | `event/*` | Cover art is generated (grid and nodes), not stock imagery |
| ProfileCard | `profile/profile-card.tsx` | 4:5 portrait, term line, placeholder state |

## Event content rules

- Every event shows five distinct phases: registration period, event start and end, submission deadline, judging period, result announcement (`EventTimeline`, `buildTimelineRows`). Unscheduled phases read "To be announced".
- Dates always carry an explicit time zone (`formatDateTime`).
- Status derives from one function, `deriveEventStatus`, unit-tested at every boundary.
- Sample content is always labeled (`SampleNotice`, `SampleBadge`, `PlaceholderBadge`); an e2e test enforces it.
- No emojis in announcements or UI copy.

## Motion and interaction (UI refresh)

Buttons lift no shadow but press down 1px with a deeper orange; cards gain an orange hairline on hover; table rows tint on hover; `main` fades in over 250 ms (opacity only, so contrast and layout are unaffected). Everything is disabled under `prefers-reduced-motion`. Area and administration navigation are underline tabs that scroll horizontally on narrow screens.

## Orange-first surface system (second UI pass)

Black stays dominant; orange is identity and feedback. Defined once in `globals.css`:

- **Ambient light:** `main#main::before` draws a burnt-orange radial glow, a faint matrix grid and a sparse circuit of orange data points behind the top of every page. The glow position changes by area (`:has()` on the area navigation): account left, organizer centre, judge right, administration right with a faint left counter-light. Sections add `ambient-left/right/center/bottom`.
- **Cards:** every card uses `.shadow-card`: charcoal, a faint orange tint from the top-left and an orange top hairline. A card holding a `<dt>`/`<dd>` pair is a key-figure card (stronger tint, orange edge, orange figure, staggered entrance). A list item or article with a link is interactive (orange edge glow, 2 px lift on hover). Event cards add generated network art with orange nodes, orange connection lines, one slowly pulsing node and one slow light pulse along an edge, plus a dark-orange date panel.
- **Navigation:** account areas use a segmented control with an orange-tinted active pill; administration uses a sticky sidebar on large screens (scrolling pill row below `lg`); the main navigation has an animated orange underline.
- **Controls:** orange focus border and halo on inputs, orange checkbox/radio/range, orange file-picker button and date icon, orange table header rule and row hover, orange progress and chart bars (gradient deep to soft orange, growing in once).
- **Semantic colours stay semantic:** `Badge` tones (`accent`, `success`, `warning`, `danger`, `neutral`); status badges for full (warning) and cancelled (danger).
- **Motion:** node pulse (4.5 s), edge flow (9 s), card hover, popover/menu/dialog pop-in (160 ms), page fade, KPI entrance. All collapse to their final state under `prefers-reduced-motion`.

## Orange glass (third UI pass)

Defined in `globals.css`; backdrop blur is used only where content scrolls underneath (navbar, About menu, mobile menu, the sticky administration sidebar), never on lists of cards. Every blurred class has a near-solid fallback under `@supports not (backdrop-filter)`.

| Class | Use | Intensity |
|---|---|---|
| `.glass-nav` | Sticky navbar: dark orange-tinted glass, orange hairline and a soft orange glow on the lower edge | strongest |
| `.glass` | Dropdown and mobile menus, administration sidebar | strong, blurred |
| `.panel-orange` | Event date panel, leadership information section, public team cards; brightens when the parent `.group` is hovered or focused | strong, no blur |
| `.glass-soft` and `form[role="search"]` | Account-area tabs, every search and filter form | light, no blur |
| `.brand-logo`, `.brand-logo-hero` | Warm orange tint and soft glow on the unchanged logo file, by CSS filter only. The wordmark "ShadowTrix" is plain white, bold, 20 px (no gradient, no glow) | n/a |

## Hero typewriter headline (fourth UI pass)

`src/components/home/typewriter-word.tsx` animates the orange word of the hero headline (`Enter the Matrix` / `of <word>`): it types the word letter by letter with an orange caret, holds about 1.7 s, deletes it letter by letter (faster than typing), pauses 0.35 s and types the next one, through Innovation, Creativity, Technology, Possibilities, The Future, forever.

- **No layout shift:** an invisible copy of the longest word reserves the width; the heading height and the buttons never move (a test samples them every 60 ms at 1440, 820, 390 and 320 px).
- **Accessibility:** the heading's name is one constant, visually hidden sentence ("Enter the Matrix of Innovation."); the two visual lines are `aria-hidden`, so screen readers never hear the changing letters. The text exists once for crawlers; the server render shows the first word complete, so it works without JavaScript.
- **Reduced motion:** no typing and no caret; "Innovation" stays (and follows the setting if it changes while the page is open).
- **Styling:** `.hero-word` (orange gradient text with a solid colour fallback and a soft glow), `.hero-caret` and `.hero-caret-blink` in `globals.css`.
- The word list is `HERO_WORDS` in `hero.tsx`.

## Logo tint

`.brand-logo` and `.brand-logo-hero` now use `brightness() sepia() saturate() hue-rotate()` so the near-white logo reads as soft orange. A plain sepia tint only produced cream. The artwork files are unchanged; removing the class restores the original.

## Category cards

Event-format cards on the home page use `.panel-orange` (dark orange gradient, orange border, orange title, accent line, arrow, hover lift and brightened edge). The event-detail "Date / Format / Places" panel uses the same recipe. The team registration notice is green (confirmed) or amber (waiting list) to keep status semantics.
