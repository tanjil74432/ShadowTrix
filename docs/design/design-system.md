# ShadowTrix Design System

Source of truth: [`web/src/app/globals.css`](../../web/src/app/globals.css) (tokens) and `web/src/components/` (components). A live reference page renders every component: `/design-system` (hidden unless `ENABLE_STYLEGUIDE=true`, never indexed).

Direction: pure black base, white and silver type, monochrome accents, grid and network motifs taken from the logo. No neon, no decorative gradients, no glow effects, no glassmorphism.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#000000` | Page background (brand black) |
| `surface` | `#0a0a0a` | Alternate section background, cards |
| `surface-raised` | `#121212` | Cards on `surface`, inputs, menus |
| `border` | `#262626` | Hairlines, dividers |
| `border-strong` | `#404040` | Outlined buttons, badges |
| `field-border` | `#737373` | Form control boundary |
| `fg` | `#fafafa` | Primary text |
| `fg-muted` | `#a3a3a3` | Secondary text |
| `fg-subtle` | `#8c8c8c` | Captions, labels (still AA) |
| `silver` | `#d4d4d4` | Designations, emphasis within muted text |
| `accent` | `#ffffff` | The one emphasized action, focus ring |
| `danger` | `#ff9a9a` | Form errors only, always with icon and text |

### Verified contrast (WCAG 2.2 AA: 4.5:1 text, 3:1 UI boundaries)

| Pair | Ratio |
|---|---|
| `fg` on `bg` | 20.12 |
| `fg-muted` on `bg` / `surface-raised` | 8.33 / 7.43 |
| `fg-subtle` on `bg` / `surface-raised` | 6.25 / 5.57 |
| `silver` on `bg` | 14.17 |
| `bg` on `accent` (primary button) | 21.00 |
| `danger` on `surface-raised` | 9.22 |
| `field-border` on `bg` / `surface-raised` | 4.43 / 3.95 |

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
- Shadow: depth on black comes from hairlines. `shadow-card` (1px white at 7%), `shadow-card-hover` (22% edge plus soft drop), `shadow-overlay` (menus and dialogs).

## Breakpoints

Tailwind defaults: `sm` 640, `md` 768 (header switches to the dialog menu below this), `lg` 1024 (3-column grids), `xl` 1280, `2xl` 1536. Tested at 360, 768, 1024 and 1440.

## Motion guidelines

1. Motion is subtle and purposeful: a one-time reveal of the hero, hover/focus transitions of 150 to 250 ms, a slow zoom on event cover art.
2. Durations: `--duration-fast` 150 ms, `--duration-base` 250 ms, `--duration-slow` 700 ms; easing `ease-out-soft`.
3. No looping animation except the pulse ring on the "Live now" status and loading skeletons.
4. `prefers-reduced-motion: reduce` removes all movement and looping globally (final states still apply), and the hero text is visible immediately. Tested.
5. Animated text exists once in the DOM and works without JavaScript (see `AnimatedHeadline`).

## Accessibility conventions

- Focus: a single 2px white outline with 3px offset on every focusable element (`:focus-visible`).
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
