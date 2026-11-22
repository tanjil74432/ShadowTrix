import { z } from "zod";

/**
 * The Universal Matrix Leadership Template: ONE design shared by every board member, plus a small per-member style (portrait position and
 * decorative text). Pure and dependency-free apart from zod, so the same definition validates on the server and drives the live preview in
 * the browser. Everything is stored as JSON in the existing `site_settings` table (no schema change) and is clamped by these schemas.
 *
 * The decorative text is visual only: it never replaces or modifies the member's verified name or designation.
 */
export const BASES = ["#090909", "#141414", "#1c1c1c"] as const; // ShadowTrix backgrounds
export const ACCENTS = ["#f07832", "#d95f1b", "#ff9a55"] as const; // ShadowTrix oranges
/** The three decorative-text colours: white / silver, burnt orange (ShadowTrix) and emerald-neon green. */
export const TEXT_COLORS = ["#f4f4f6", "#f07832", "#2ee59d"] as const;
export const TEXT_COLOR_LABELS: Record<(typeof TEXT_COLORS)[number], string> = { "#f4f4f6": "White / silver", "#f07832": "Burnt orange", "#2ee59d": "Emerald green" };
/** The five decorative typography presets. Each is a different typeface AND treatment (see components/leadership/decorative-text.tsx). */
export const TYPO_PRESETS = ["calligraphy", "signature", "futuristic", "editorial", "matrix"] as const;
export type TypoPreset = (typeof TYPO_PRESETS)[number];
export const TYPO_PRESET_INFO: Record<TypoPreset, { label: string; blurb: string }> = {
  calligraphy: { label: "Elegant Calligraphy", blurb: "Flowing, formal pen lettering (Pinyon Script)." },
  signature: { label: "Luxury Signature", blurb: "A refined signature with a long underline stroke (Mrs Saint Delafield)." },
  futuristic: { label: "Futuristic Display", blurb: "Wide, geometric outline lettering (Orbitron)." },
  editorial: { label: "Editorial Serif", blurb: "High-contrast magazine serif with fine rules (DM Serif Display)." },
  matrix: { label: "Matrix Typography", blurb: "Digital scan-line lettering with a glitch echo (Share Tech Mono)." },
};

const num = (min: number, max: number, dflt: number) => z.number().min(min).max(max).default(dflt);
const oneOf = <T extends readonly [string, ...string[]]>(values: T, dflt: T[number]) => z.enum(values).default(dflt);

const background = z.object({
  base: oneOf(BASES, "#090909"),
  accent: oneOf(ACCENTS, "#f07832"),
  grid: num(0, 100, 45),
  circuit: num(0, 100, 55),
  glow: num(0, 100, 60),
  particles: num(0, 100, 40),
});
const typography = z.object({
  preset: oneOf(TYPO_PRESETS, "futuristic"),
  color: oneOf(TEXT_COLORS, "#f07832"),
  size: num(8, 24, 20), // 24 = the largest size that fits the card (full width); smaller values scale the lettering down in proportion, so every step is visible and nothing clips
  opacity: num(0.05, 1, 0.5),
  letterSpacing: num(-0.05, 0.4, 0.02), // em, added to the preset's own spacing
  x: num(-50, 50, 0),
  y: num(-50, 50, -2),
  rotation: num(-20, 20, 0),
  layer: oneOf(["behind", "back"] as const, "behind"), // "back" also puts it behind the grid and circuits
});
const portrait = z.object({
  align: oneOf(["bottom", "center"] as const, "bottom"),
  zoom: num(0.5, 3, 1),
  x: num(-50, 50, 0),
  y: num(-50, 50, 0),
});
const board = z.object({
  align: oneOf(["left", "center"] as const, "left"),
  nameSize: num(4, 9, 6.4), // container-width percent
  detailSize: num(2.4, 5, 3.4),
  gap: num(0.4, 4, 1.4),
  border: oneOf(["solid", "double", "none"] as const, "solid"),
  accent: oneOf(ACCENTS, "#f07832"),
  overlap: num(0, 20, 6), // how far the board rises over the portrait (percent of the card width)
  showUnit: z.boolean().default(true),
  showTerm: z.boolean().default(true),
  showDepartment: z.boolean().default(true),
  showUniversity: z.boolean().default(true), // the member's university, when they have one
  showBio: z.boolean().default(false),
  showSkills: z.boolean().default(false),
  showLinks: z.boolean().default(false),
  showEmail: z.boolean().default(true), // the contact email, only when the member made it public (as the team page always did)
});

const DEFAULTS = {
  background: background.parse({}),
  typography: typography.parse({}),
  portrait: portrait.parse({}),
  board: board.parse({}),
};

export const leadershipTemplateSchema = z.object({
  background: background.default(DEFAULTS.background),
  typography: typography.default(DEFAULTS.typography),
  portrait: portrait.default(DEFAULTS.portrait),
  board: board.default(DEFAULTS.board),
});
export type LeadershipTemplate = z.infer<typeof leadershipTemplateSchema>;
export const DEFAULT_LEADERSHIP_TEMPLATE: LeadershipTemplate = leadershipTemplateSchema.parse({});

export const memberStyleSchema = z.object({
  /** Portrait adjustment on top of the template: zoom multiplies, offsets add. */
  zoom: num(0.5, 3, 1),
  x: num(-50, 50, 0),
  y: num(-50, 50, 0),
  /** Decorative text for this member. Empty = the member's own name. Visual only. */
  text: z.string().trim().max(40, "At most 40 characters.").transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "")).default(""),
  textX: num(-40, 40, 0),
  textY: num(-40, 40, 0),
  textScale: num(0.5, 1.6, 1),
});
export type MemberStyle = z.infer<typeof memberStyleSchema>;
export const DEFAULT_MEMBER_STYLE: MemberStyle = memberStyleSchema.parse({});

/**
 * Templates saved before the typography presets stored a free font, weight and colour. They are read as the default preset with the saved colour
 * mapped to the nearest of the three allowed ones (anything else stays untouched, so a damaged value still falls back to the default design).
 * Writes always go through the strict schema above.
 */
function migrateStored(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const t = (raw as { typography?: unknown }).typography;
  if (!t || typeof t !== "object" || Array.isArray(t)) return raw;
  const { font: _font, weight: _weight, ...rest } = t as Record<string, unknown>;
  void _font; void _weight;
  if (typeof rest.size === "number") rest.size = Math.min(24, rest.size); // the size control used to go up to 40
  const c = typeof rest.color === "string" ? rest.color.toLowerCase() : null;
  if (c && !(TEXT_COLORS as readonly string[]).includes(c) && /^#[0-9a-f]{6}$/.test(c)) {
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    rest.color = r > 200 && g > 200 && b > 200 ? "#f4f4f6" : g > r ? "#2ee59d" : "#f07832"; // light -> silver, green-ish -> green, otherwise orange
  }
  return { ...(raw as object), typography: rest };
}

/** Public rendering must never fail because of stored data: anything invalid falls back to the defaults. */
export function parseTemplate(raw: unknown): LeadershipTemplate {
  const r = leadershipTemplateSchema.safeParse(migrateStored(raw));
  return r.success ? r.data : DEFAULT_LEADERSHIP_TEMPLATE;
}
export function parseMemberStyle(raw: unknown): MemberStyle {
  const r = memberStyleSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_MEMBER_STYLE;
}

export const TEMPLATE_KEY = "leadership_template";
export const MEMBER_STYLE_PREFIX = "leadership_member:";
export const memberStyleKey = (memberId: string) => `${MEMBER_STYLE_PREFIX}${memberId}`;
