/**
 * Official ShadowTrix personal banner, drawn with the Canvas 2D API entirely in the browser (no photo ever leaves the device).
 * ONE universal layout for everybody. The same function paints the on-screen preview and the exported PNG, so what you see is what you
 * get: the canvas is always 1080 x 1350 and the preview is only that canvas scaled down with CSS.
 *
 * The "identity text" is decoration chosen freely by the person (FOUNDER, MY TEAM, anything). It is a large heading ABOVE the portrait (never
 * behind or over it), is never stored, and has nothing to do with the verified designation, which is a separate, server-approved line in the
 * information panel.
 */
export const BANNER_W = 1080;
export const BANNER_H = 1350;
export const NAME_MAX = 60;
export const TAGLINE_MAX = 90;
export const FIELD_MAX = 80; // university, department, event
export const TEAM_MAX = 60;
export const BG_TEXT_MAX = 24;
export const PORTRAIT_MAX_BYTES = 12 * 1024 * 1024;
export const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface Crop {
  /** 1 = the portrait just covers the frame; larger zooms in. */
  zoom: number;
  /** -1..1 horizontal / vertical position inside the available overflow (0 = centred). */
  x: number;
  y: number;
}

/** The heading above the portrait. (The type keeps its early name; it is the "identity text" in the editor.) */
export interface BackgroundText {
  text: string;
  /** Font size in canvas pixels (60..200). Reduced automatically when the text would not fit the heading band. */
  size: number;
  /** -1..1 position inside the free part of the heading band (0 = centred). */
  x: number;
  y: number;
  /** 0.15..1 */
  opacity: number;
  /** Degrees, -12..12: a heading tilts slightly, it does not turn on its side. */
  rotation: number;
}

export const SIZE_RANGE = { min: 60, max: 200 } as const;
export const OPACITY_RANGE = { min: 0.15, max: 1 } as const;
export const ROTATION_RANGE = { min: -12, max: 12 } as const;
export const DEFAULT_BACKGROUND: BackgroundText = { text: "SHADOW", size: 190, x: 0, y: 0, opacity: 0.92, rotation: 0 };

export interface BannerInput {
  name: string;
  /** The verified, server-approved designation (never free text). */
  designation?: string;
  university?: string;
  department?: string;
  event?: string;
  team?: string;
  tagline?: string;
  background: BackgroundText;
  portrait: CanvasImageSource | null;
  portraitSize: { w: number; h: number } | null;
  crop: Crop;
  logo: CanvasImageSource | null;
  fontFamily: string;
}

const C = {
  bg: "#090909", orange: "#f07832", deep: "#d95f1b", soft: "#ff9a55", light: "#ffb27a", fg: "#f5f5f5", silver: "#d4d4d4", muted: "#a3a3a3",
};
export const FRAME = { x: 190, y: 215, w: 810, h: 645 };
export const PANEL = { x: 190, y: 885, w: 810, h: 405 };
/** The heading band: directly above the portrait, lined up with it (clear of the vertical wordmark), with a clear gap above the frame. Never overlaps the portrait. */
export const BG_ZONE = { x: 190, y: 22, w: 810, h: 168 };
export const HEADING_GAP = FRAME.y - (BG_ZONE.y + BG_ZONE.h); // space between the heading band and the portrait frame

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Deterministic pseudo-random numbers so the background is identical every time (preview, export, tests). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let backgroundCache: HTMLCanvasElement | OffscreenCanvas | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

/** Black base, burnt-orange ambient light, faint repeating brand text, a matrix of glyph columns, grid hairlines, halo rings and network nodes. Drawn once and cached. */
function background(): CanvasImageSource {
  if (backgroundCache) return backgroundCache as CanvasImageSource;
  const cv = makeCanvas(BANNER_W, BANNER_H);
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, BANNER_W, BANNER_H);
  const glow = (x: number, y: number, r: number, a: number) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(217,95,27,${a})`);
    rg.addColorStop(1, "rgba(217,95,27,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, BANNER_W, BANNER_H);
  };
  glow(1000, 1250, 760, 0.42);
  glow(60, 140, 520, 0.22);
  glow(600, 110, 520, 0.2); // soft light behind the heading band

  // Faint rows of brand text, drifting sideways row by row.
  g.save();
  g.font = "700 40px ui-monospace, Menlo, Consolas, monospace";
  g.textBaseline = "top";
  const chain = "SHADOWTRIX   //   ENTER THE MATRIX   //   TEAM EU SHADOW   //   ";
  const unit = g.measureText(chain).width || 1;
  const row = chain.repeat(Math.ceil((BANNER_W + unit) / unit) + 1);
  for (let i = 0, y = 14; y < BANNER_H; i++, y += 78) {
    g.fillStyle = i % 5 === 0 ? "rgba(255,154,85,0.07)" : "rgba(240,120,50,0.035)";
    g.fillText(row, -((i * 173) % unit), y);
  }
  g.restore();

  const r = rng(20260101);
  g.font = "600 22px ui-monospace, Menlo, Consolas, monospace";
  g.textBaseline = "top";
  const glyphs = "01{}[]<>/\\=+*#$%&;:ABCDEF0123456789";
  for (let col = 0; col < 36; col++) {
    const x = col * 30 + 6 + r() * 6;
    const len = 4 + Math.floor(r() * 30);
    const start = r() * BANNER_H * 0.9;
    const strength = 0.25 + r() * 0.75;
    for (let i = 0; i < len; i++) {
      const y = start + i * 27;
      if (y > BANNER_H) break;
      const head = i === len - 1;
      g.fillStyle = head ? `rgba(255,154,85,${0.55 * strength})` : `rgba(240,120,50,${0.05 + 0.2 * strength * (i / len)})`;
      g.fillText(glyphs[Math.floor(r() * glyphs.length)], x, y);
    }
  }
  // Irregular grid: long hairlines at uneven spacing, not a repeating tile.
  g.strokeStyle = "rgba(240,120,50,0.09)";
  g.lineWidth = 1;
  let gx = 0;
  while (gx < BANNER_W) { gx += 60 + r() * 150; g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, BANNER_H); g.stroke(); }
  let gy = 0;
  while (gy < BANNER_H) { gy += 70 + r() * 170; g.beginPath(); g.moveTo(0, gy); g.lineTo(BANNER_W, gy); g.stroke(); }
  // Geometric halo rings behind the portrait.
  g.strokeStyle = "rgba(255,154,85,0.2)";
  g.lineWidth = 2;
  for (const rad of [380, 470, 560]) { g.beginPath(); g.arc(BANNER_W * 0.6, 520, rad, 0, Math.PI * 2); g.stroke(); }
  // Network nodes and links.
  const nodes = Array.from({ length: 28 }, () => ({ x: r() * BANNER_W, y: r() * BANNER_H }));
  g.strokeStyle = "rgba(240,120,50,0.2)";
  g.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes.map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) })).filter((o) => o.j > i && o.d < 280).slice(0, 2);
    for (const o of near) { g.beginPath(); g.moveTo(nodes[i].x, nodes[i].y); g.lineTo(nodes[o.j].x, nodes[o.j].y); g.stroke(); }
  }
  nodes.forEach((n, i) => { g.fillStyle = i % 4 === 0 ? "rgba(255,154,85,0.85)" : "rgba(240,120,50,0.45)"; g.beginPath(); g.arc(n.x, n.y, i % 4 === 0 ? 4 : 2.5, 0, Math.PI * 2); g.fill(); });
  // Darken the vignette so the portrait and text stay dominant.
  const v = g.createRadialGradient(BANNER_W / 2, BANNER_H / 2, 300, BANNER_W / 2, BANNER_H / 2, 950);
  v.addColorStop(0, "rgba(9,9,9,0.35)");
  v.addColorStop(1, "rgba(9,9,9,0)");
  g.fillStyle = v;
  g.fillRect(0, 0, BANNER_W, BANNER_H);
  backgroundCache = cv;
  return cv as CanvasImageSource;
}

/** Word-wraps `text` into at most `maxLines` lines no wider than `maxW`, shrinking the font from `start` to `min` first. */
export function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number, start: number, min: number, font: (px: number) => string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let px = start; px >= min; px -= 2) {
    g.font = font(px);
    const lines: string[] = [];
    let cur = "";
    let ok = true;
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width <= maxW) cur = next;
      else {
        if (!cur || g.measureText(w).width > maxW) { ok = false; break; }
        lines.push(cur);
        cur = w;
      }
    }
    if (ok) lines.push(cur);
    if (ok && lines.length <= maxLines) return { px, lines };
  }
  // Last resort at the minimum size: break over-long words by character, keep `maxLines` lines and end the last with an ellipsis.
  g.font = font(min);
  const lines: string[] = [];
  let cur = "";
  const push = (piece: string) => {
    const next = cur ? `${cur} ${piece}` : piece;
    if (g.measureText(next).width <= maxW) cur = next;
    else { if (cur) lines.push(cur); cur = piece; }
  };
  for (const w of words) {
    if (g.measureText(w).width <= maxW) { push(w); continue; }
    if (cur) { lines.push(cur); cur = ""; }
    for (const ch of w) {
      if (g.measureText(cur + ch).width <= maxW) cur += ch;
      else { lines.push(cur); cur = ch; }
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return { px: min, lines };
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last.length > 1 && g.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  out[maxLines - 1] = `${last}…`;
  return { px: min, lines: out };
}

// ───────────────────────────── Background text ─────────────────────────────

export interface BackgroundPlan {
  text: string;
  size: number;
  /** Centre of the text box and its rotation. */
  cx: number;
  cy: number;
  rotation: number;
  opacity: number;
  /** Axis-aligned box that contains the (rotated) text; always inside BG_ZONE, so above the portrait. */
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Places the identity text. The size is reduced until the rotated text fits the heading band, and the position is limited so the box never
 * leaves it: the text can neither be clipped by the edge of the banner nor touch the portrait. Pure given a measuring context (unit-tested).
 */
export function planBackgroundText(g: CanvasRenderingContext2D, bg: BackgroundText, ff: string): BackgroundPlan | null {
  const text = bg.text.replace(/\s+/g, " ").trim().toUpperCase().slice(0, BG_TEXT_MAX);
  if (!text) return null;
  const rotation = clamp(Number.isFinite(bg.rotation) ? bg.rotation : 0, ROTATION_RANGE.min, ROTATION_RANGE.max);
  const rad = (rotation * Math.PI) / 180;
  let size = clamp(Number.isFinite(bg.size) ? bg.size : DEFAULT_BACKGROUND.size, SIZE_RANGE.min, SIZE_RANGE.max);
  let w = 0, h = 0, bw = 0, bh = 0;
  for (;;) {
    g.font = `800 ${size}px ${ff}`;
    w = g.measureText(text).width;
    h = size * 0.82; // cap height of the capitals that are drawn
    bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    if ((bw <= BG_ZONE.w && bh <= BG_ZONE.h) || size <= 24) break;
    size = Math.max(24, Math.floor(size * 0.95));
  }
  const px = clamp(Number.isFinite(bg.x) ? bg.x : 0, -1, 1);
  const py = clamp(Number.isFinite(bg.y) ? bg.y : 0, -1, 1);
  const midX = BG_ZONE.x + BG_ZONE.w / 2;
  const midY = BG_ZONE.y + BG_ZONE.h / 2;
  const cx = midX + (px * Math.max(0, BG_ZONE.w - bw)) / 2;
  const cy = midY + (py * Math.max(0, BG_ZONE.h - bh)) / 2;
  return { text, size, cx, cy, rotation, opacity: clamp(Number.isFinite(bg.opacity) ? bg.opacity : DEFAULT_BACKGROUND.opacity, OPACITY_RANGE.min, OPACITY_RANGE.max), box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh } };
}

function drawBackgroundText(g: CanvasRenderingContext2D, plan: BackgroundPlan, ff: string) {
  const h = plan.size * 0.82; // cap height of the capitals that are drawn
  // A soft burnt-orange glow behind the heading (it stays inside the band's neighbourhood; the portrait is drawn after it).
  g.save();
  const r = Math.max(plan.box.w, plan.box.h) * 0.62;
  const glow = g.createRadialGradient(plan.cx, plan.cy, 0, plan.cx, plan.cy, r);
  glow.addColorStop(0, `rgba(240,120,50,${0.34 * plan.opacity})`);
  glow.addColorStop(1, "rgba(240,120,50,0)");
  g.fillStyle = glow;
  g.fillRect(plan.cx - r, plan.cy - r, 2 * r, 2 * r);
  g.restore();

  g.save();
  g.translate(plan.cx, plan.cy);
  g.rotate((plan.rotation * Math.PI) / 180);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `800 ${plan.size}px ${ff}`;
  g.lineJoin = "round";
  g.globalAlpha = plan.opacity;
  // Bright white at the top, silver in the middle, a touch of burnt orange at the foot, with an orange halo.
  const fill = g.createLinearGradient(0, -h / 2, 0, h / 2);
  fill.addColorStop(0, "#f5f5f5");
  fill.addColorStop(0.62, "#d4d4d4");
  fill.addColorStop(1, "#f08a4b");
  const baseline = h / 2; // vertically centre the capitals on (cx, cy)
  g.shadowColor = "rgba(240,120,50,0.55)";
  g.shadowBlur = 26;
  g.fillStyle = fill;
  g.fillText(plan.text, 0, baseline);
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(255,154,85,0.75)";
  g.lineWidth = 1.5;
  g.strokeText(plan.text, 0, baseline);
  g.restore();
}

// ───────────────────────────── Information panel ─────────────────────────────

export interface PanelRow {
  key: "designation" | "university" | "department" | "event" | "team" | "tagline";
  px: number;
  font: string;
  lines: string[];
  baseline: number;
  color: string;
  /** The width this row was fitted to. */
  maxW: number;
}

export interface PanelPlan {
  name: { px: number; font: string; lines: string[]; baseline: number; maxW: number };
  bar: number;
  rows: PanelRow[];
  /** Lowest y used by any text; must stay inside the panel. */
  bottom: number;
  brand: ReturnType<typeof brandZones>;
}

const PAD = 36;
const LOGO = 120;
const BOTTOM_PAD = 24;
export const TEXT_X = PANEL.x + 40;
const CAPTION = "TEAM EU SHADOW";
const captionFont = (ff: string) => `600 18px ${ff}`;
/** The top-right corner of the panel belongs to the official logo and the brand caption under it; text keeps clear of both. */
export function brandZones(captionWidth: number) {
  const right = PANEL.x + PANEL.w - 40;
  return {
    logo: { x: right - LOGO, y: PANEL.y + PAD, w: LOGO, h: LOGO },
    caption: { x: right - captionWidth, y: PANEL.y + PAD + LOGO + 30 - 18, w: captionWidth, h: 24 },
  };
}
const LOGO_BOTTOM = PANEL.y + PAD + LOGO + 40;

/**
 * Decides where every text block of the information panel goes. Rows only exist when they have text (the person chooses what to show).
 * If everything does not fit, the secondary rows shrink together, then fall back to one line each, so nothing overlaps or leaves the panel.
 * Pure given a measuring context, so tests can check it with worst-case input.
 */
export function planPanel(g: CanvasRenderingContext2D, input: Pick<BannerInput, "name" | "designation" | "university" | "department" | "event" | "team" | "tagline">, ff: string): PanelPlan {
  const innerW = PANEL.w - 2 * 40;
  g.font = captionFont(ff);
  const brand = brandZones(g.measureText(CAPTION).width);
  const nameW = innerW - Math.max(LOGO, brand.caption.w) - 30; // the logo and its caption sit at the top right
  const nameFont = (px: number) => `800 ${px}px ${ff}`;
  const name = fitText(g, input.name.trim() || "Your name", nameW, 2, 64, 34, nameFont);
  const nameBase = PANEL.y + PAD + name.px * 0.85;
  const bar = nameBase + (name.lines.length - 1) * name.px * 1.05 + 16;
  const top = bar + 5 + 18;
  const limit = PANEL.y + PANEL.h - BOTTOM_PAD;

  const spec = [
    { key: "designation" as const, text: input.designation?.trim() ?? "", maxLines: 1, start: 34, min: 20, weight: 700, color: C.soft },
    { key: "university" as const, text: input.university?.trim() ?? "", maxLines: 2, start: 30, min: 18, weight: 700, color: C.fg },
    { key: "department" as const, text: input.department?.trim() ?? "", maxLines: 1, start: 26, min: 18, weight: 600, color: C.silver },
    { key: "event" as const, text: input.event?.trim() ?? "", maxLines: 2, start: 26, min: 18, weight: 600, color: C.silver },
    { key: "team" as const, text: input.team?.trim() ?? "", maxLines: 1, start: 26, min: 18, weight: 600, color: C.silver },
    { key: "tagline" as const, text: input.tagline?.trim() ?? "", maxLines: 2, start: 24, min: 16, weight: 500, color: C.muted },
  ].filter((r) => r.text);

  const attempt = (scale: number, oneLine: boolean) => {
    let y = top;
    const rows: PanelRow[] = [];
    for (const r of spec) {
      const maxW = y < LOGO_BOTTOM ? nameW : innerW;
      const font = (px: number) => `${r.weight} ${px}px ${ff}`;
      const f = fitText(g, r.text, maxW, oneLine ? 1 : r.maxLines, Math.round((r.start * scale) / 2) * 2, Math.max(14, Math.round((r.min * scale) / 2) * 2), font);
      y += f.px * 0.85;
      rows.push({ key: r.key, px: f.px, font: font(f.px), lines: f.lines, baseline: y, color: r.color, maxW });
      y += (f.lines.length - 1) * f.px * 1.2 + f.px * 0.3 + 10;
    }
    return { rows, bottom: y - 10 };
  };
  let chosen = attempt(1, false);
  for (const s of [0.92, 0.84, 0.76, 0.68, 0.6]) {
    if (chosen.bottom <= limit) break;
    chosen = attempt(s, false);
  }
  if (chosen.bottom > limit) chosen = attempt(0.6, true);
  return { name: { px: name.px, font: nameFont(name.px), lines: name.lines, baseline: nameBase, maxW: nameW }, bar, rows: chosen.rows, bottom: Math.max(chosen.bottom, bar + 5), brand };
}

// ───────────────────────────── Drawing ─────────────────────────────

export function drawBanner(g: CanvasRenderingContext2D, input: BannerInput) {
  const { fontFamily: ff } = input;
  g.save();
  g.clearRect(0, 0, BANNER_W, BANNER_H);
  g.drawImage(background(), 0, 0);

  // Customisable identity text: a heading above the portrait.
  const bgPlan = planBackgroundText(g, input.background, ff);
  if (bgPlan) drawBackgroundText(g, bgPlan, ff);

  // Vertical wordmark on the left.
  g.save();
  g.translate(104, BANNER_H / 2 + 20);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 132px ${ff}`;
  const wm = g.createLinearGradient(-560, 0, 560, 0);
  wm.addColorStop(0, C.light); wm.addColorStop(0.5, C.orange); wm.addColorStop(1, C.deep);
  g.shadowColor = "rgba(240,120,50,0.55)";
  g.shadowBlur = 28;
  g.fillStyle = wm;
  const spaced = "SHADOWTRIX".split("").join(String.fromCharCode(0x200a, 0x200a));
  g.fillText(spaced, 0, 0, 1100);
  g.restore();
  g.strokeStyle = "rgba(240,120,50,0.55)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(170, 80); g.lineTo(170, 1290); g.stroke();

  // Portrait frame.
  g.save();
  g.shadowColor = "rgba(240,120,50,0.45)";
  g.shadowBlur = 40;
  g.fillStyle = "#141414";
  g.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  g.restore();
  g.save();
  g.beginPath(); g.rect(FRAME.x, FRAME.y, FRAME.w, FRAME.h); g.clip();
  if (input.portrait && input.portraitSize) {
    const { w, h } = input.portraitSize;
    const zoom = clamp(input.crop.zoom, 1, 4);
    const scale = Math.max(FRAME.w / w, FRAME.h / h) * zoom;
    const dw = w * scale, dh = h * scale;
    const ox = (dw - FRAME.w) / 2, oy = (dh - FRAME.h) / 2;
    const dx = FRAME.x - ox - clamp(input.crop.x, -1, 1) * ox;
    const dy = FRAME.y - oy - clamp(input.crop.y, -1, 1) * oy;
    g.drawImage(input.portrait, dx, dy, dw, dh);
    // Warm grade so every portrait sits in the same colour world, then fade the bottom into the info panel.
    g.fillStyle = "rgba(217,95,27,0.08)";
    g.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  } else {
    const ph = g.createLinearGradient(FRAME.x, FRAME.y, FRAME.x + FRAME.w, FRAME.y + FRAME.h);
    ph.addColorStop(0, "#2b1a10"); ph.addColorStop(1, "#141414");
    g.fillStyle = ph; g.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
    g.fillStyle = "rgba(240,120,50,0.55)";
    g.beginPath(); g.arc(FRAME.x + FRAME.w / 2, FRAME.y + 240, 108, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(FRAME.x + FRAME.w / 2, FRAME.y + 595, 245, 235, 0, Math.PI, 0); g.fill();
    g.fillStyle = C.silver; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.font = `600 30px ${ff}`;
    g.fillText("Upload a portrait", FRAME.x + FRAME.w / 2, FRAME.y + FRAME.h - 40);
  }
  const fade = g.createLinearGradient(0, FRAME.y + FRAME.h - 200, 0, FRAME.y + FRAME.h);
  fade.addColorStop(0, "rgba(9,9,9,0)"); fade.addColorStop(1, "rgba(9,9,9,0.85)");
  g.fillStyle = fade; g.fillRect(FRAME.x, FRAME.y + FRAME.h - 200, FRAME.w, 200);
  g.restore();
  // Double frame.
  g.strokeStyle = "rgba(240,120,50,0.85)"; g.lineWidth = 3;
  g.strokeRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  g.strokeStyle = C.soft; g.lineWidth = 1.5;
  g.strokeRect(FRAME.x + 14, FRAME.y + 14, FRAME.w - 28, FRAME.h - 28);

  // Information panel: dark orange glass.
  g.save();
  const pg = g.createLinearGradient(PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y + PANEL.h);
  pg.addColorStop(0, "rgba(58,32,18,0.96)"); pg.addColorStop(1, "rgba(26,17,12,0.96)");
  g.shadowColor = "rgba(240,120,50,0.35)"; g.shadowBlur = 30;
  g.fillStyle = pg; g.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  g.restore();
  g.strokeStyle = "rgba(240,120,50,0.65)"; g.lineWidth = 2;
  g.strokeRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);

  const plan = planPanel(g, input, ff);
  const tx = TEXT_X;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = C.fg;
  g.font = plan.name.font;
  plan.name.lines.forEach((line, i) => g.fillText(line, tx, plan.name.baseline + i * plan.name.px * 1.05));
  const lineGrad = g.createLinearGradient(tx, 0, tx + 120, 0);
  lineGrad.addColorStop(0, C.orange); lineGrad.addColorStop(1, C.soft);
  g.fillStyle = lineGrad; g.fillRect(tx, plan.bar, 120, 5);
  for (const row of plan.rows) {
    g.font = row.font;
    g.fillStyle = row.color;
    row.lines.forEach((line, i) => g.fillText(line, tx, row.baseline + i * row.px * 1.2));
  }
  // Logo (the unchanged official mark) with a soft orange glow, and the brand caption under it.
  if (input.logo) {
    g.save();
    g.shadowColor = "rgba(240,120,50,0.6)"; g.shadowBlur = 24;
    g.drawImage(input.logo, PANEL.x + PANEL.w - 40 - LOGO, PANEL.y + PAD, LOGO, LOGO);
    g.restore();
  }
  g.fillStyle = "rgba(255,154,85,0.85)"; g.font = captionFont(ff); g.textAlign = "right";
  g.fillText(CAPTION, PANEL.x + PANEL.w - 40, PANEL.y + PAD + LOGO + 30);
  g.restore();
}
