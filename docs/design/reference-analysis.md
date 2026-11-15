# Reference Analysis: Forkship (https://www.forkship.tech/)

Purpose: learn from Forkship's content organization and quality bar. Nothing here is to be copied (code, assets, branding, exact layouts).

**Source note:** Based on a fetch of the live homepage text on 2026-11-15. The separate "supplied design audit" mentioned in the brief was not attached to the conversation, so the audit-derived items below come from the brief's summary list and from what was observable in the fetched text. Visual properties (fonts, colors, contrast ratios, animation) could not be measured from text alone and need a browser-based review once the audit is supplied.

## What Forkship does well

| Area | Observation | ShadowTrix takeaway |
|---|---|---|
| Section order | Hero → what we are (4 pillars) → events → leadership → focus areas → announcements → join CTA → footer | Clear, scannable story. Keep a similar narrative arc. |
| Event cards | Image, date badge, status tag, type tag, title, short description, When/Where, registration status, whole card clickable | Adopt the data model; improve consistency (see below). |
| Leadership | Board preview with term label and "Meet the board" link | Matches our Organization module; add term and archive support. |
| Accessibility | "Skip to content" link present | Required in ShadowTrix from day one. |

## Problems to avoid

| Issue | Evidence | ShadowTrix rule |
|---|---|---|
| Too many hero CTAs | Three: Join, Explore events, Member portal | Max two: primary "Explore Events", secondary "Join ShadowTrix". |
| Competing headlines | "Let's dive into the core Engineering" above a separate tagline, plus a closing hero line | One H1, one supporting sentence. |
| Duplicate accessible hero text | Reported in audit | Render hero text once; decorative duplicates `aria-hidden`. |
| Missing auth entry in nav | No sign-in/join in top nav | Login and Register visible in nav (Register styled as the single nav CTA). |
| Nav label mismatch | "News" links to "Announcements" | Labels must match destination headings. |
| Inconsistent event info | "5-hour" hackathon shown with a multi-week date range, unclear whether it is the event or registration window | Separate fields: event start/end, registration open/close, duration. Label each explicitly. |
| Spelling/copy errors | "presenets", missing space ("engineeringideasideas"), "Forkhip" slug, "Linkedin", lowercase sentence starts, inconsistent title case | Copy review checklist and automated spellcheck in CI for content files; slugs generated from validated titles. |
| Alt text vs visible text mismatch | Member title differs between alt and visible text | Single source of truth for member designation; alt text built from the same field. |
| No community section | Community content scattered across leadership, focus areas, footer | Dedicated Community page plus a homepage highlights section. |
| Focus-area tags (static list) | 13 bullets with no interaction | Make them filter links into Explore Events. |
| Color contrast concerns | Reported in audit | All text meets WCAG 2.2 AA (4.5:1 body, 3:1 large). Gray-on-black text tokens validated before use. |

## Design principles for ShadowTrix

1. Black (#000000) base, off-white text, silver/gray secondaries; minimal monochrome highlights.
2. Motifs drawn from the logo: network nodes and edges, hexagonal frames, orbital arcs, subtle grid. Used sparingly and never behind body text.
3. No neon, no decorative gradients, no heavy glassmorphism or glowing cards.
4. Motion: short, purposeful transitions; respect `prefers-reduced-motion`.
5. Status indicators use text plus shape, not color alone (Open, Opens soon, Closed, Live, Ended).
6. Semantic HTML, one H1 per page, per-page metadata, Open Graph tags, sitemap.
7. Mobile first; verify at 360, 768, 1024, 1440 px.

## Logo observations (assets/branding/1.png)

Monochrome white/silver on pure black: a wireframe globe of connected nodes, crossed by two silver orbital swooshes, framed by a broken hexagon. 1254×1254, square canvas with generous black padding. This supports the "connected network" language. Open item: the file is a raster with a black background. A transparent PNG or SVG will be needed for the navbar and favicon; per the brief, we will request one rather than recreate the logo.
