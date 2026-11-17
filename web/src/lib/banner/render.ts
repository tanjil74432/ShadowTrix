/**
 * Official ShadowTrix personal banner, drawn with the Canvas 2D API entirely in the browser (no photo ever leaves the device).
 * The same function paints the on-screen preview and the exported PNG, so what you see is what you get: the canvas is always
 * 1080 x 1350 and the preview is only that canvas scaled down with CSS.
 */
export const BANNER_W = 1080;
export const BANNER_H = 1350;
export const NAME_MAX = 60;
export const TAGLINE_MAX = 90;
export const EVENT_MAX = 80;
export const PORTRAIT_MAX_BYTES = 12 * 1024 * 1024;
export const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface Crop {
  /** 1 = the portrait just covers the frame; larger zooms in. */
  zoom: number;
  /** -1..1 horizontal / vertical position inside the available overflow (0 = centred). */
  x: number;
  y: number;
}

import { TEMPLATES, type TemplateId, type TemplateSpec } from "./templates";

export interface BannerInput {
  template: TemplateId;
  name: string;
  designation?: string;
  /** An event the person is genuinely linked to (chosen from a server-provided list). */
  event?: string;
  /** Organization line printed under the logo. */
  organization: string;
  tagline?: string;
  portrait: CanvasImageSource | null;
  portraitSize: { w: number; h: number } | null;
  crop: Crop;
  logo: CanvasImageSource | null;
  fontFamily: string;
}

const C = {
  bg: "#090909", orange: "#f07832", deep: "#d95f1b", soft: "#ff9a55", light: "#ffb27a", fg: "#f5f5f5", silver: "#d4d4d4",
};
export const FRAME = { x: 190, y: 80, w: 810, h: 800 };
export const PANEL = { x: 190, y: 905, w: 810, h: 385 };

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

const backgroundCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

/** The words repeated faintly behind everything: brand, role, the person, their event and organization. Same input, same pixels. */
export function identityWords(input: Pick<BannerInput, "template" | "name" | "event" | "organization">): string[] {
  const words = ["SHADOWTRIX", TEMPLATES[input.template].badge, input.name.trim().toUpperCase(), input.event?.trim().toUpperCase(), input.organization.trim().toUpperCase()];
  return words.filter((w): w is string => Boolean(w)).map((w) => (w.length > 28 ? `${w.slice(0, 27)}…` : w));
}

const hash = (str: string) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

/** Black base, ambient light, glyph matrix, identity text, a template motif and network nodes. Cached per template and identity. */
function background(t: TemplateSpec, words: string[]): CanvasImageSource {
  const key = `${t.id}|${words.join("|")}`;
  const hit = backgroundCache.get(key);
  if (hit) return hit as CanvasImageSource;
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
  glow(t.glow.x * BANNER_W, t.glow.y * BANNER_H, 780, 0.4);
  glow(BANNER_W - t.glow.x * BANNER_W, BANNER_H - t.glow.y * BANNER_H, 520, 0.2);
  glow(560, 560, 520, 0.1);

  // Identity text: faint monospace rows that drift sideways row by row, so the background says who and what this banner is.
  g.save();
  g.font = "700 40px ui-monospace, Menlo, Consolas, monospace";
  g.textBaseline = "top";
  const chain = words.join("   //   ") + "   //   ";
  const unit = g.measureText(chain).width || 1;
  const reps = Math.ceil((BANNER_W + unit) / unit) + 1;
  const row = chain.repeat(reps);
  for (let i = 0, y = 14; y < BANNER_H; i++, y += 78) {
    g.fillStyle = i % 5 === 0 ? "rgba(255,154,85,0.085)" : "rgba(240,120,50,0.045)";
    g.fillText(row, -((i * 173 + hash(key) % 97) % unit), y);
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
  // Irregular grid: long hairlines at uneven spacing. The organizer template makes it stronger.
  g.strokeStyle = t.motif === "grid" ? "rgba(240,120,50,0.14)" : "rgba(240,120,50,0.07)";
  g.lineWidth = 1;
  let gx = 0;
  while (gx < BANNER_W) { gx += 60 + r() * 150; g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, BANNER_H); g.stroke(); }
  let gy = 0;
  while (gy < BANNER_H) { gy += 70 + r() * 170; g.beginPath(); g.moveTo(0, gy); g.lineTo(BANNER_W, gy); g.stroke(); }
  // Network nodes and links (denser for the team template).
  const count = t.motif === "network" ? 40 : 22;
  const nodes = Array.from({ length: count }, () => ({ x: r() * BANNER_W, y: r() * BANNER_H }));
  g.strokeStyle = "rgba(240,120,50,0.2)";
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes.map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) })).filter((o) => o.j > i && o.d < 280).slice(0, 2);
    for (const o of near) { g.beginPath(); g.moveTo(nodes[i].x, nodes[i].y); g.lineTo(nodes[o.j].x, nodes[o.j].y); g.stroke(); }
  }
  nodes.forEach((n, i) => { g.fillStyle = i % 4 === 0 ? "rgba(255,154,85,0.85)" : "rgba(240,120,50,0.45)"; g.beginPath(); g.arc(n.x, n.y, i % 4 === 0 ? 4 : 2.5, 0, Math.PI * 2); g.fill(); });
  // Template motifs.
  if (t.motif === "scan") { g.fillStyle = "rgba(255,154,85,0.05)"; for (let y = 0; y < BANNER_H; y += 6) g.fillRect(0, y, BANNER_W, 2); }
  if (t.motif === "diagonal") { g.strokeStyle = "rgba(255,154,85,0.12)"; g.lineWidth = 2; for (let x = -BANNER_H; x < BANNER_W; x += 90) { g.beginPath(); g.moveTo(x, BANNER_H); g.lineTo(x + BANNER_H, 0); g.stroke(); } }
  if (t.motif === "halo") { g.strokeStyle = "rgba(255,154,85,0.22)"; g.lineWidth = 2; for (const rad of [380, 470, 560]) { g.beginPath(); g.arc(BANNER_W * 0.6, 470, rad, 0, Math.PI * 2); g.stroke(); } }
  // Darken the vignette so the portrait and text stay dominant.
  const v = g.createRadialGradient(BANNER_W / 2, BANNER_H / 2, 300, BANNER_W / 2, BANNER_H / 2, 950);
  v.addColorStop(0, "rgba(9,9,9,0.35)");
  v.addColorStop(1, "rgba(9,9,9,0)");
  g.fillStyle = v;
  g.fillRect(0, 0, BANNER_W, BANNER_H);
  if (backgroundCache.size >= 4) backgroundCache.delete(backgroundCache.keys().next().value as string);
  backgroundCache.set(key, cv);
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
  while (last.length > 1 && g.measureText(`${last}\u2026`).width > maxW) last = last.slice(0, -1);
  out[maxLines - 1] = `${last}\u2026`;
  return { px: min, lines: out };
}

export interface PanelPlan {
  name: { px: number; lines: string[]; baseline: number };
  bar: number;
  designation: { px: number; lines: string[]; baseline: number } | null;
  event: { px: number; lines: string[]; baseline: number } | null;
  tagline: { px: number; lines: string[]; baseline: number } | null;
  /** Lowest y used by the top-down content and highest y used by the tagline; the first must stay above the second. */
  contentBottom: number;
  taglineTop: number;
}

const PAD = 36;
const LOGO = 120;

/** Decides where every text block of the information panel goes. Pure given a measuring context, so tests can check that nothing overlaps. */
export function planPanel(g: CanvasRenderingContext2D, input: Pick<BannerInput, "name" | "designation" | "event" | "tagline">, ff: string): PanelPlan {
  const innerW = PANEL.w - 2 * 40;
  const nameW = innerW - LOGO - 30; // the logo sits at the top right
  const name = fitText(g, input.name.trim() || "Your name", nameW, 2, 64, 34, (px) => `800 ${px}px ${ff}`);
  let y = PANEL.y + PAD + name.px * 0.85;
  const nameBase = y;
  y += (name.lines.length - 1) * name.px * 1.05;
  const bar = y + 16;
  y = bar + 5 + 18;
  const des = input.designation?.trim();
  let designation: PanelPlan["designation"] = null;
  if (des) {
    const d = fitText(g, des, nameW, 1, 34, 20, (px) => `700 ${px}px ${ff}`);
    y += d.px * 0.85;
    designation = { px: d.px, lines: d.lines, baseline: y };
    y += d.px * 0.3 + 14;
  }
  const ev = input.event?.trim();
  let event: PanelPlan["event"] = null;
  if (ev) {
    const e = fitText(g, ev, innerW - 250, 2, 28, 20, (px) => `600 ${px}px ${ff}`);
    y += e.px * 0.85;
    event = { px: e.px, lines: e.lines, baseline: y };
    y += (e.lines.length - 1) * e.px * 1.2 + e.px * 0.3 + 10;
  }
  const contentBottom = y;
  const tag = input.tagline?.trim();
  let tagline: PanelPlan["tagline"] = null;
  let taglineTop = PANEL.y + PANEL.h;
  if (tag) {
    const t = fitText(g, tag, innerW, 2, 26, 18, (px) => `500 ${px}px ${ff}`);
    const first = PANEL.y + PANEL.h - 26 - (t.lines.length - 1) * t.px * 1.25;
    tagline = { px: t.px, lines: t.lines, baseline: first };
    taglineTop = first - t.px * 0.9;
  }
  return { name: { px: name.px, lines: name.lines, baseline: nameBase }, bar, designation, event, tagline, contentBottom, taglineTop };
}

function drawFrame(g: CanvasRenderingContext2D, t: TemplateSpec) {
  const { x, y, w, h } = FRAME;
  g.strokeStyle = "rgba(240,120,50,0.85)";
  g.lineWidth = 3;
  if (t.frame === "brackets") {
    const L = 70;
    g.lineWidth = 7;
    g.strokeStyle = t.accentSoft;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
      g.beginPath(); g.moveTo(cx + dx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * L); g.stroke();
    }
    g.lineWidth = 2; g.strokeStyle = "rgba(240,120,50,0.5)"; g.strokeRect(x, y, w, h);
  } else if (t.frame === "double") {
    g.strokeRect(x, y, w, h);
    g.lineWidth = 1.5; g.strokeStyle = t.accentSoft;
    g.strokeRect(x + 14, y + 14, w - 28, h - 28);
  } else if (t.frame === "notch") {
    g.strokeRect(x, y, w, h);
    g.fillStyle = t.accent;
    g.beginPath(); g.moveTo(x + w - 90, y); g.lineTo(x + w, y); g.lineTo(x + w, y + 90); g.closePath(); g.fill();
  } else {
    g.strokeRect(x, y, w, h);
  }
}

export function drawBanner(g: CanvasRenderingContext2D, input: BannerInput) {
  const { fontFamily: ff } = input;
  const t = TEMPLATES[input.template] ?? TEMPLATES.participant;
  g.save();
  g.clearRect(0, 0, BANNER_W, BANNER_H);
  g.drawImage(background(t, identityWords(input)), 0, 0);

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
    g.beginPath(); g.arc(FRAME.x + FRAME.w / 2, FRAME.y + 320, 120, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(FRAME.x + FRAME.w / 2, FRAME.y + 680, 260, 250, 0, Math.PI, 0); g.fill();
    g.fillStyle = C.silver; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.font = `600 30px ${ff}`;
    g.fillText("Upload a portrait", FRAME.x + FRAME.w / 2, FRAME.y + FRAME.h - 40);
  }
  const fade = g.createLinearGradient(0, FRAME.y + FRAME.h - 220, 0, FRAME.y + FRAME.h);
  fade.addColorStop(0, "rgba(9,9,9,0)"); fade.addColorStop(1, "rgba(9,9,9,0.85)");
  g.fillStyle = fade; g.fillRect(FRAME.x, FRAME.y + FRAME.h - 220, FRAME.w, 220);
  g.restore();
  drawFrame(g, t);

  // Role badge on the portrait.
  g.save();
  g.font = `800 28px ${ff}`;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const label = t.badge.split("").join(String.fromCharCode(0x200a));
  const bw = g.measureText(label).width + 44, bh = 54, bx = FRAME.x + 30, by = FRAME.y + 30;
  if (t.badgeFilled) { g.fillStyle = t.accent; g.fillRect(bx, by, bw, bh); } else { g.fillStyle = "rgba(9,9,9,0.7)"; g.fillRect(bx, by, bw, bh); g.strokeStyle = t.accentSoft; g.lineWidth = 2; g.strokeRect(bx, by, bw, bh); }
  g.fillStyle = t.badgeFilled ? "#f5f5f5" : t.accentSoft;
  g.fillText(label, bx + 22, by + 37);
  g.restore();

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
  const tx = PANEL.x + 40;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = C.fg;
  plan.name.lines.forEach((line, i) => { g.font = `800 ${plan.name.px}px ${ff}`; g.fillText(line, tx, plan.name.baseline + i * plan.name.px * 1.05); });
  const lineGrad = g.createLinearGradient(tx, 0, tx + 120, 0);
  lineGrad.addColorStop(0, t.accent); lineGrad.addColorStop(1, t.accentSoft);
  g.fillStyle = lineGrad; g.fillRect(tx, plan.bar, 120, 5);
  if (plan.designation) { g.fillStyle = C.soft; g.font = `700 ${plan.designation.px}px ${ff}`; g.fillText(plan.designation.lines[0], tx, plan.designation.baseline); }
  if (plan.event) { const ev = plan.event; g.font = `600 ${ev.px}px ${ff}`; g.fillStyle = C.silver; ev.lines.forEach((line, i) => g.fillText(line, tx, ev.baseline + i * ev.px * 1.2)); }
  if (plan.tagline) {
    const tg = plan.tagline;
    g.fillStyle = C.silver;
    tg.lines.forEach((line, i) => { g.font = `500 ${tg.px}px ${ff}`; g.fillText(line, tx, tg.baseline + i * tg.px * 1.25); });
  }
  // Logo (the unchanged official mark) with a soft orange glow, and the organization under it.
  if (input.logo) {
    g.save();
    g.shadowColor = "rgba(240,120,50,0.6)"; g.shadowBlur = 24;
    g.drawImage(input.logo, PANEL.x + PANEL.w - 40 - LOGO, PANEL.y + PAD, LOGO, LOGO);
    g.restore();
  }
  const org = fitText(g, input.organization.trim().toUpperCase(), 230, 1, 22, 14, (px) => `600 ${px}px ${ff}`);
  g.fillStyle = "rgba(255,154,85,0.85)"; g.font = `600 ${org.px}px ${ff}`; g.textAlign = "right";
  g.fillText(org.lines[0], PANEL.x + PANEL.w - 40, PANEL.y + PAD + LOGO + 30);
  g.restore();
}
