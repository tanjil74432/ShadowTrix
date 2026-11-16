/**
 * Official ShadowTrix personal banner, drawn with the Canvas 2D API entirely in the browser (no photo ever leaves the device).
 * The same function paints the on-screen preview and the exported PNG, so what you see is what you get: the canvas is always
 * 1080 x 1350 and the preview is only that canvas scaled down with CSS.
 */
export const BANNER_W = 1080;
export const BANNER_H = 1350;
export const NAME_MAX = 60;
export const TAGLINE_MAX = 90;
export const PORTRAIT_MAX_BYTES = 12 * 1024 * 1024;
export const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface Crop {
  /** 1 = the portrait just covers the frame; larger zooms in. */
  zoom: number;
  /** -1..1 horizontal / vertical position inside the available overflow (0 = centred). */
  x: number;
  y: number;
}

export interface BannerInput {
  name: string;
  designation?: string;
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
export const FRAME = { x: 190, y: 80, w: 810, h: 830 };
const PANEL = { x: 190, y: 940, w: 810, h: 350 };

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

/** Black base, burnt-orange ambient light, an irregular matrix of glyph columns, sparse network nodes. Drawn once and cached. */
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
  glow(560, 560, 520, 0.1);

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
  // Irregular grid: a few long hairlines at uneven spacing, not a repeating tile.
  g.strokeStyle = "rgba(240,120,50,0.07)";
  g.lineWidth = 1;
  let gx = 0;
  while (gx < BANNER_W) { gx += 60 + r() * 150; g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, BANNER_H); g.stroke(); }
  let gy = 0;
  while (gy < BANNER_H) { gy += 70 + r() * 170; g.beginPath(); g.moveTo(0, gy); g.lineTo(BANNER_W, gy); g.stroke(); }
  // Network nodes and links.
  const nodes = Array.from({ length: 22 }, () => ({ x: r() * BANNER_W, y: r() * BANNER_H }));
  g.strokeStyle = "rgba(240,120,50,0.2)";
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
  while (last.length > 1 && g.measureText(`${last}\u2026`).width > maxW) last = last.slice(0, -1);
  out[maxLines - 1] = `${last}\u2026`;
  return { px: min, lines: out };
}

export function drawBanner(g: CanvasRenderingContext2D, input: BannerInput) {
  const { fontFamily: ff } = input;
  g.save();
  g.clearRect(0, 0, BANNER_W, BANNER_H);
  g.drawImage(background(), 0, 0);

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
    g.beginPath(); g.arc(FRAME.x + FRAME.w / 2, FRAME.y + 330, 120, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(FRAME.x + FRAME.w / 2, FRAME.y + 700, 260, 250, 0, Math.PI, 0); g.fill();
    g.fillStyle = C.silver; g.textAlign = "center"; g.font = `600 30px ${ff}`;
    g.fillText("Upload a portrait", FRAME.x + FRAME.w / 2, FRAME.y + FRAME.h - 40);
  }
  const fade = g.createLinearGradient(0, FRAME.y + FRAME.h - 220, 0, FRAME.y + FRAME.h);
  fade.addColorStop(0, "rgba(9,9,9,0)"); fade.addColorStop(1, "rgba(9,9,9,0.85)");
  g.fillStyle = fade; g.fillRect(FRAME.x, FRAME.y + FRAME.h - 220, FRAME.w, 220);
  g.restore();
  g.strokeStyle = "rgba(240,120,50,0.8)"; g.lineWidth = 3;
  g.strokeRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);

  // Information panel: dark orange glass.
  g.save();
  const pg = g.createLinearGradient(PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y + PANEL.h);
  pg.addColorStop(0, "rgba(58,32,18,0.96)"); pg.addColorStop(1, "rgba(26,17,12,0.96)");
  g.shadowColor = "rgba(240,120,50,0.35)"; g.shadowBlur = 30;
  g.fillStyle = pg; g.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  g.restore();
  g.strokeStyle = "rgba(240,120,50,0.65)"; g.lineWidth = 2;
  g.strokeRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);

  const textMaxW = PANEL.w - 80 - 150; // leave room for the logo on the right
  const tx = PANEL.x + 40;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  const name = input.name.trim() || "Your name";
  const nm = fitText(g, name, textMaxW, 2, 64, 36, (px) => `800 ${px}px ${ff}`);
  let y = PANEL.y + 40 + nm.px * 0.9;
  g.fillStyle = C.fg;
  for (const line of nm.lines) { g.font = `800 ${nm.px}px ${ff}`; g.fillText(line, tx, y); y += nm.px * 1.05; }
  y += 8 - nm.px * 0.05;
  const lineGrad = g.createLinearGradient(tx, 0, tx + 120, 0);
  lineGrad.addColorStop(0, C.orange); lineGrad.addColorStop(1, C.soft);
  g.fillStyle = lineGrad; g.fillRect(tx, y, 120, 5);
  y += 20;
  const des = input.designation?.trim();
  if (des) {
    const d = fitText(g, des, textMaxW, 1, 36, 22, (px) => `700 ${px}px ${ff}`);
    g.fillStyle = C.soft;
    y += d.px * 0.85;
    for (const line of d.lines) { g.font = `700 ${d.px}px ${ff}`; g.fillText(line, tx, y); y += d.px * 1.15; }
  }
  const tag = input.tagline?.trim();
  if (tag) {
    const t = fitText(g, tag, PANEL.w - 80, 2, 26, 18, (px) => `500 ${px}px ${ff}`);
    g.fillStyle = C.silver;
    const base = PANEL.y + PANEL.h - 28 - (t.lines.length - 1) * t.px * 1.25;
    t.lines.forEach((line, i) => { g.font = `500 ${t.px}px ${ff}`; g.fillText(line, tx, base + i * t.px * 1.25); });
  }
  // Logo (the unchanged official mark) with a soft orange glow.
  if (input.logo) {
    g.save();
    g.shadowColor = "rgba(240,120,50,0.6)"; g.shadowBlur = 24;
    g.drawImage(input.logo, PANEL.x + PANEL.w - 40 - 120, PANEL.y + 36, 120, 120);
    g.restore();
  }
  g.fillStyle = "rgba(255,154,85,0.85)"; g.font = `600 22px ${ff}`; g.textAlign = "right";
  g.fillText("TEAM EU SHADOW", PANEL.x + PANEL.w - 40, PANEL.y + 192);
  g.restore();
}
