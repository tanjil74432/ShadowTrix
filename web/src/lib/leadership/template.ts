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
export const TEXT_COLORS = ["#ff9a55", "#f07832", "#d95f1b", "#d4d4d4", "#a3a3a3", "#f5f5f5"] as const;
export const FONTS = ["sans", "mono", "serif", "script"] as const;
export const FONT_LABELS: Record<(typeof FONTS)[number], string> = { sans: "Geist Sans", mono: "Geist Mono", serif: "Serif (system)", script: "Script (system)" };
export const FONT_STACKS: Record<(typeof FONTS)[number], string> = {
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, Menlo, Consolas, monospace",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
  script: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive",
};
export const WEIGHTS = [400, 600, 700, 800, 900] as const;

const num = (min: number, max: number, dflt: number) => z.number().min(min).max(max).default(dflt);
const hex = (dflt: string) => z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #ff9a55.").transform((v) => v.toLowerCase()).default(dflt);
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
  font: oneOf(FONTS, "sans"),
  weight: z.number().refine((w) => (WEIGHTS as readonly number[]).includes(w), "Choose one of the listed weights.").default(900),
  color: hex("#ff9a55"),
  size: num(8, 40, 16), // container-width percent
  opacity: num(0.05, 1, 0.3),
  letterSpacing: num(-0.05, 0.4, 0.02), // em
  x: num(-50, 50, 0),
  y: num(-50, 50, -8),
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

/** Public rendering must never fail because of stored data: anything invalid falls back to the defaults. */
export function parseTemplate(raw: unknown): LeadershipTemplate {
  const r = leadershipTemplateSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_LEADERSHIP_TEMPLATE;
}
export function parseMemberStyle(raw: unknown): MemberStyle {
  const r = memberStyleSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_MEMBER_STYLE;
}

export const TEMPLATE_KEY = "leadership_template";
export const MEMBER_STYLE_PREFIX = "leadership_member:";
export const memberStyleKey = (memberId: string) => `${MEMBER_STYLE_PREFIX}${memberId}`;
