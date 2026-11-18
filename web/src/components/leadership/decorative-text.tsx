import type { CSSProperties, ReactNode } from "react";
import { TYPO_PRESET_INFO, type TypoPreset } from "@/lib/leadership/template";

/**
 * The five decorative typography presets of the Universal Matrix Leadership Template. Each one is a different typeface AND a different
 * treatment (fill, outline, echo, rules, scan lines), drawn with CSS and inline SVG only. Pure and server-compatible: it is used by the card and by
 * the admin preset previews. The text is visual only (aria-hidden); it never replaces the member's verified name or designation.
 *
 * Sizes are in `cqw` (percent of the card's width), so the lettering scales with the card at every size.
 */
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
/** A lighter tint of a colour, for gradient highlights. */
const lighten = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};

interface PresetSpec {
  family: string;
  /** The widest average glyph width in em (measured over a range of real names), used to keep the lettering inside the card. */
  width: number;
  upper: boolean;
  /** The preset's own tracking, in em, before the template's letter-spacing control is added. */
  spacing: number;
  /** Extra tilt in degrees. */
  tilt: number;
  /** Line height (em) when the name is stacked on several lines. */
  line: number;
}

const SPECS: Record<TypoPreset, PresetSpec> = {
  calligraphy: { family: "var(--lt-font-calligraphy), 'Segoe Script', 'Snell Roundhand', cursive", width: 0.56, upper: false, spacing: 0, tilt: 0, line: 0.82 },
  signature: { family: "var(--lt-font-signature), 'Segoe Script', 'Brush Script MT', cursive", width: 0.5, upper: false, spacing: 0, tilt: -5, line: 0.78 },
  futuristic: { family: "var(--lt-font-futuristic), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif", width: 0.84, upper: true, spacing: 0.06, tilt: 0, line: 1.02 },
  editorial: { family: "var(--lt-font-editorial), ui-serif, Georgia, 'Times New Roman', serif", width: 0.65, upper: true, spacing: 0.02, tilt: 0, line: 0.96 },
  matrix: { family: "var(--lt-font-matrix), var(--font-geist-mono), ui-monospace, Menlo, Consolas, monospace", width: 0.57, upper: true, spacing: 0.1, tilt: 0, line: 1.06 },
};

export interface DecorativeTextProps {
  preset: TypoPreset;
  text: string;
  color: string;
  /** The size control: SIZE_FULL is the largest size that fits the card; smaller values scale the lettering down in proportion. */
  size: number;
  /** The template's letter-spacing control, in em (added to the preset's own). */
  letterSpacing: number;
  /** 0-100: how strong the glow is (the template's glow control). */
  glow: number;
  /** The widest the lettering may be, in cqw. */
  maxWidth?: number;
}

/**
 * Longer names are stacked on two or three lines (balanced by length), which lets the lettering be much larger inside the same card width.
 * One word, or a short name, stays on one line.
 */
export function splitLines(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text.trim()];
  const target = words.length <= 4 ? 2 : 3;
  const total = words.join(" ").length;
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    // start a new line once the current one has its share of the characters (and lines remain)
    if (cur && lines.length < target - 1 && cur.length >= total / target - 1 && next.length > cur.length) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The tallest the lettering block may be, in cqw (so a three-line name never grows past the middle of the card). */
const MAX_BLOCK_HEIGHT = 58;

/** The value of the size control that means "as large as fits the card". */
export const SIZE_FULL = 24;
/** No lettering is ever drawn larger than this, in cqw (a two-letter name would otherwise become enormous). */
const MAX_FONT = 30;

/**
 * The final font size in cqw. The largest size that fits is worked out from the typeface's real glyph widths, the number of stacked lines and the
 * card's width and height; the size control then picks a fraction of it (SIZE_FULL = all of it). Every position of the control changes the size, and
 * at or below SIZE_FULL the lettering always stays inside the card. A member's own text-size adjustment multiplies the control, so it may go past full.
 */
export function decorativeFontSize(preset: TypoPreset, text: string, size: number, letterSpacing: number, maxWidth = 90) {
  const s = SPECS[preset];
  const lines = splitLines(text);
  const longest = Math.max(1, ...lines.map((l) => l.length)) + (preset === "matrix" ? 0.9 : 0); // the matrix cursor counts as about one character
  const fitWidth = maxWidth / (longest * Math.max(0.2, s.width + s.spacing + letterSpacing) + 0.34); // + the padding on both sides
  const fitHeight = MAX_BLOCK_HEIGHT / (lines.length * s.line + 0.4);
  return Math.max(2, Math.min(MAX_FONT, fitWidth, fitHeight) * (size / SIZE_FULL));
}

/** Padding keeps ascenders, descenders and swashes inside the painted area of gradient-filled text (no clipped letter tips). */
const PAD = "0.16em 0.14em 0.26em";

export function DecorativeText({ preset, text, color, size, letterSpacing, glow, maxWidth }: DecorativeTextProps): ReactNode {
  const s = SPECS[preset];
  const fontSize = decorativeFontSize(preset, text, size, letterSpacing, maxWidth);
  const g = Math.max(0, Math.min(1, glow / 100));
  const lines = splitLines(s.upper ? text.toUpperCase() : text);
  /** The lettering, one block per line (names with several words are stacked). `after` is added at the end of the last line. */
  const body = (after?: ReactNode) => lines.map((l, i) => <span key={i} style={{ display: "block" }}>{l}{i === lines.length - 1 ? after : null}</span>);
  const base: CSSProperties = {
    position: "relative",
    display: "inline-block",
    textAlign: "center",
    whiteSpace: "nowrap",
    lineHeight: s.line,
    fontFamily: s.family,
    fontSize: `${fontSize}cqw`,
    letterSpacing: `${s.spacing + letterSpacing}em`,
    fontWeight: preset === "futuristic" ? 800 : 400,
    transform: s.tilt ? `rotate(${s.tilt}deg)` : undefined,
  };
  const glowFx = (strength: number) => `drop-shadow(0 0 ${(0.9 + 1.8 * g).toFixed(2)}cqw ${rgba(color, strength * (0.35 + 0.65 * g))})`;
  const gradientText = (stops: string): CSSProperties => ({
    backgroundImage: stops,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
    padding: PAD,
  });

  switch (preset) {
    case "calligraphy":
      return (
        <span style={{ ...base, ...gradientText(`linear-gradient(180deg, ${lighten(color, 0.6)} 0%, ${color} 55%, ${rgba(color, 0.8)} 100%)`), filter: glowFx(0.9) }}>{body()}</span>
      );
    case "signature":
      return (
        <span style={{ ...base, color, padding: PAD, filter: glowFx(0.8) }}>
          {body()}
          {/* the long underline stroke of a signature */}
          <svg aria-hidden="true" viewBox="0 0 200 22" preserveAspectRatio="none" style={{ position: "absolute", left: "2%", bottom: "-0.02em", width: "96%", height: "0.26em", overflow: "visible" }}>
            <path d="M2 15 C34 4 70 20 112 9 S176 8 198 3" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d="M40 19 C80 13 130 21 176 13" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </span>
      );
    case "futuristic":
      return (
        <span style={{ ...base, padding: PAD, filter: glowFx(0.85) }}>
          {/* an offset outline echo behind the main outlined lettering, which has a faint fill */}
          <span aria-hidden="true" style={{ position: "absolute", inset: 0, padding: PAD, transform: "translate(0.9cqw, 0.9cqw)", color: "transparent", WebkitTextStroke: `0.14cqw ${rgba(color, 0.5)}` }}>{body()}</span>
          <span style={{ position: "relative", display: "block", color: rgba(color, 0.16), WebkitTextStroke: `0.26cqw ${color}` }}>{body()}</span>
        </span>
      );
    case "editorial": {
      const rule: CSSProperties = { position: "absolute", left: "0.1em", right: "0.1em", height: "0.04em", minHeight: "1px", background: `linear-gradient(90deg, transparent, ${rgba(color, 0.9)} 18%, ${rgba(color, 0.9)} 82%, transparent)` };
      return (
        <span style={{ ...base, filter: glowFx(0.45) }}>
          <span aria-hidden="true" style={{ ...rule, top: "0.02em" }} />
          <span style={{ display: "block", ...gradientText(`linear-gradient(180deg, ${lighten(color, 0.65)} 0%, ${color} 46%, ${rgba(color, 0.7)} 100%)`) }}>{body()}</span>
          <span aria-hidden="true" style={{ ...rule, bottom: "0.02em" }} />
        </span>
      );
    }
    case "matrix": {
      const scan = `repeating-linear-gradient(0deg, ${color} 0 0.34em, ${rgba(color, 0.28)} 0.34em 0.42em)`;
      const echo: CSSProperties = { position: "absolute", inset: 0, padding: PAD, color: "transparent" };
      const cursor = <span aria-hidden="true" style={{ display: "inline-block", width: "0.48em", height: "0.78em", marginLeft: "0.14em", verticalAlign: "-0.04em", background: rgba(color, 0.85) }} />;
      return (
        <span style={{ ...base, padding: PAD, filter: glowFx(0.7) }}>
          {/* digital echo: two offset copies, like a signal glitch */}
          <span aria-hidden="true" style={{ ...echo, transform: "translate(-0.7cqw, -0.35cqw)", WebkitTextStroke: `0.12cqw ${rgba(color, 0.4)}` }}>{body()}</span>
          <span aria-hidden="true" style={{ ...echo, transform: "translate(0.7cqw, 0.35cqw)", WebkitTextStroke: `0.12cqw ${rgba(color, 0.25)}` }}>{body()}</span>
          <span style={{ position: "relative", display: "block", backgroundImage: scan, backgroundSize: "100% 0.42em", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>{body(cursor)}</span>
        </span>
      );
    }
  }
}

/** The preset's display name, for labels. */
export const presetLabel = (p: TypoPreset) => TYPO_PRESET_INFO[p].label;
