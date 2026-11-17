import "server-only";
import type { MatrixContext } from "@/lib/banner/render";

/**
 * The ShadowTrix Matrix banner design. SERVER-ONLY source: this file is never part of the public JavaScript bundle. The browser of an
 * administrator receives it from `GET /api/v1/banner/templates/matrix/renderer`, which answers 401 to anonymous visitors and 403 to
 * everybody who is not an administrator, and runs it as an ES module (the Content-Security-Policy allows same-origin scripts).
 *
 * The function is SELF-CONTAINED on purpose: it is shipped by serialising it with `Function.prototype.toString`, so it may use nothing
 * from this module or any import (a test runs it in an empty sandbox to prove it). It also avoids syntax that a compiler could rewrite
 * into helper calls (spread, optional chaining, for-of over iterables, classes).
 *
 * It draws the background, the large decorative text behind the portrait, the vertical wordmark, the portrait frame and the information
 * card. The portrait pixels and the panel text come from the caller (`ctx.drawPortrait`, `ctx.drawPanelText`), so the uploaded photo is
 * never altered and text layout behaves exactly as in the Classic design. The identity text is decoration only.
 */
export function drawMatrixBanner(g: CanvasRenderingContext2D, ctx: MatrixContext): void {
  const W = ctx.W, H = ctx.H, F = ctx.frame, P = ctx.panel, ff = ctx.fontFamily;
  const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  let seed = 1999031;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const glow = (x: number, y: number, r: number, a: number) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, "rgba(217,95,27," + a + ")");
    rg.addColorStop(1, "rgba(217,95,27,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  };

  // 1. Deep black base with burnt-orange ambient light.
  g.fillStyle = "#070707";
  g.fillRect(0, 0, W, H);
  glow(W * 0.62, 520, 780, 0.3);
  glow(90, 140, 430, 0.22);
  glow(1040, 1240, 640, 0.36);

  // 2. Fine technical grid: a faint line every 36 px, a stronger one every 180 px.
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 36) {
    g.strokeStyle = x % 180 === 0 ? "rgba(240,120,50,0.11)" : "rgba(240,120,50,0.045)";
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
  }
  for (let y = 0; y <= H; y += 36) {
    g.strokeStyle = y % 180 === 0 ? "rgba(240,120,50,0.11)" : "rgba(240,120,50,0.045)";
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
  }

  // 3. Circuit traces in the side margins: right-angle paths that end in a pad with a ring.
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let k = 0; k < 18; k++) {
    const left = k % 2 === 0;
    const minX = left ? 8 : 1006, maxX = left ? 160 : 1072;
    let x = minX + rnd() * (maxX - minX);
    let y = 40 + rnd() * (H - 80);
    let horizontal = rnd() < 0.5;
    g.strokeStyle = "rgba(240,120,50,0.36)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y);
    const segments = 3 + Math.floor(rnd() * 4);
    for (let s = 0; s < segments; s++) {
      const len = 30 + rnd() * 120;
      const dir = rnd() < 0.5 ? -1 : 1;
      if (horizontal) x = clampN(x + dir * len, minX, maxX);
      else y = clampN(y + dir * len, 20, H - 20);
      g.lineTo(x, y);
      horizontal = !horizontal;
    }
    g.stroke();
    g.fillStyle = "#ff9a55";
    g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,154,85,0.55)";
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
  }

  // 4. A quiet rain of code glyphs in the margins.
  g.font = "600 18px ui-monospace, Menlo, Consolas, monospace";
  g.textAlign = "left";
  g.textBaseline = "top";
  const glyphs = "01{}[]<>/=+*#$%&;:ABCDEF";
  for (let c = 0; c < 12; c++) {
    const gx = c < 6 ? 14 + c * 24 : 1010 + (c - 6) * 11;
    const len = 6 + Math.floor(rnd() * 22);
    const start = rnd() * (H - 600);
    for (let i = 0; i < len; i++) {
      g.fillStyle = i === len - 1 ? "rgba(255,154,85,0.55)" : "rgba(240,120,50," + (0.05 + 0.16 * (i / len)) + ")";
      g.fillText(glyphs.charAt(Math.floor(rnd() * glyphs.length)), gx, start + i * 22);
    }
  }

  // 5. Large decorative identity text BEHIND the portrait: the lower part of the letters is covered by the portrait frame.
  const id = ctx.identity;
  const text = String(id.text || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 24);
  if (text) {
    const rotation = (clampN(isFinite(id.rotation) ? id.rotation : 0, -12, 12) * Math.PI) / 180;
    let size = clampN((isFinite(id.size) ? id.size : 190) * 1.6, 100, 330);
    // The text stays to the right of the vertical rule (x = 170), so it never runs into the SHADOWTRIX wordmark.
    const zoneX = 190, zoneW = W - 190 - 12;
    let tw = 0, th = 0, bw = 0, bh = 0;
    for (;;) {
      g.font = "900 " + size + "px " + ff;
      tw = g.measureText(text).width;
      th = size * 0.82;
      bw = Math.abs(tw * Math.cos(rotation)) + Math.abs(th * Math.sin(rotation));
      bh = Math.abs(tw * Math.sin(rotation)) + Math.abs(th * Math.cos(rotation));
      if ((bw <= zoneW && bh <= 330) || size <= 40) break;
      size = Math.floor(size * 0.95);
    }
    const px = clampN(isFinite(id.x) ? id.x : 0, -1, 1);
    const py = clampN(isFinite(id.y) ? id.y : 0, -1, 1);
    const alpha = clampN(isFinite(id.opacity) ? id.opacity : 0.92, 0.15, 1);
    const cx = zoneX + zoneW / 2 + (px * Math.max(0, zoneW - bw)) / 2;
    const cy = Math.max(10 + bh / 2, 172 + py * 60);
    g.save();
    g.translate(cx, cy);
    g.rotate(rotation);
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = "900 " + size + "px " + ff;
    g.lineJoin = "round";
    const fill = g.createLinearGradient(0, -th / 2, 0, th / 2);
    fill.addColorStop(0, "rgba(255,255,255," + alpha * 0.42 + ")");
    fill.addColorStop(1, "rgba(240,120,50," + alpha * 0.34 + ")");
    g.shadowColor = "rgba(240,120,50," + alpha * 0.7 + ")";
    g.shadowBlur = 34;
    g.fillStyle = fill;
    g.fillText(text, 0, th / 2);
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,154,85," + alpha * 0.75 + ")";
    g.lineWidth = 2.5;
    g.strokeText(text, 0, th / 2);
    g.restore();
  }

  // 6. Vertical SHADOWTRIX wordmark on the left, with the vertical rule.
  g.save();
  g.translate(104, H / 2 + 20);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "800 132px " + ff;
  const wm = g.createLinearGradient(-560, 0, 560, 0);
  wm.addColorStop(0, "#ffb27a"); wm.addColorStop(0.5, "#f07832"); wm.addColorStop(1, "#d95f1b");
  g.shadowColor = "rgba(240,120,50,0.6)";
  g.shadowBlur = 30;
  g.fillStyle = wm;
  const spaced = "SHADOWTRIX".split("").join(String.fromCharCode(0x200a, 0x200a));
  g.fillText(spaced, 0, 0, 1100);
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(255,200,150,0.35)";
  g.lineWidth = 1.2;
  g.strokeText(spaced, 0, 0, 1100);
  g.restore();
  g.strokeStyle = "rgba(240,120,50,0.6)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(170, 80); g.lineTo(170, 1290); g.stroke();

  // 7. Portrait frame: chamfered top-left and bottom-right corners, a neon rim and corner brackets.
  const cut = 34;
  const chamfered = (x: number, y: number, w: number, h: number, c: number, topLeftAndBottomRight: boolean) => {
    g.beginPath();
    if (topLeftAndBottomRight) {
      g.moveTo(x + c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - c); g.lineTo(x + w - c, y + h); g.lineTo(x, y + h); g.lineTo(x, y + c);
    } else {
      g.moveTo(x, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c);
    }
    g.closePath();
  };
  g.save();
  chamfered(F.x, F.y, F.w, F.h, cut, true);
  g.shadowColor = "rgba(240,120,50,0.8)";
  g.shadowBlur = 52;
  g.fillStyle = "#101010";
  g.fill();
  g.restore();
  g.save();
  chamfered(F.x, F.y, F.w, F.h, cut, true);
  g.clip();
  ctx.drawPortrait(g);
  g.restore();
  chamfered(F.x, F.y, F.w, F.h, cut, true);
  g.strokeStyle = "rgba(255,154,85,0.95)";
  g.lineWidth = 3;
  g.stroke();
  chamfered(F.x + 14, F.y + 14, F.w - 28, F.h - 28, cut - 10, true);
  g.strokeStyle = "rgba(240,120,50,0.55)";
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeStyle = "#ffb27a";
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(F.x + F.w - 70, F.y - 8); g.lineTo(F.x + F.w + 8, F.y - 8); g.lineTo(F.x + F.w + 8, F.y + 70); g.stroke();
  g.beginPath(); g.moveTo(F.x - 8, F.y + F.h - 70); g.lineTo(F.x - 8, F.y + F.h + 8); g.lineTo(F.x + 70, F.y + F.h + 8); g.stroke();

  // 8. Information card: dark glass with chamfered top-right and bottom-left corners and an orange accent.
  g.save();
  chamfered(P.x, P.y, P.w, P.h, 28, false);
  const card = g.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
  card.addColorStop(0, "rgba(28,16,10,0.96)");
  card.addColorStop(1, "rgba(10,10,10,0.97)");
  g.shadowColor = "rgba(240,120,50,0.4)";
  g.shadowBlur = 34;
  g.fillStyle = card;
  g.fill();
  g.restore();
  g.save();
  chamfered(P.x, P.y, P.w, P.h, 28, false);
  g.clip();
  g.strokeStyle = "rgba(240,120,50,0.05)";
  g.lineWidth = 1;
  for (let ly = P.y + 6; ly < P.y + P.h; ly += 6) { g.beginPath(); g.moveTo(P.x, ly); g.lineTo(P.x + P.w, ly); g.stroke(); }
  const accent = g.createLinearGradient(0, P.y + 28, 0, P.y + P.h - 28);
  accent.addColorStop(0, "#ff9a55"); accent.addColorStop(1, "rgba(240,120,50,0.15)");
  g.fillStyle = accent;
  g.fillRect(P.x + 12, P.y + 28, 4, P.h - 56);
  g.restore();
  chamfered(P.x, P.y, P.w, P.h, 28, false);
  g.strokeStyle = "rgba(255,154,85,0.75)";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "#ff9a55";
  g.fillRect(P.x, P.y, 150, 5);
  ctx.drawPanelText(g);
}

/** The ES module that is delivered to administrators: the function above, as source text. */
export function matrixRendererModuleSource(): string {
  return "export default (" + drawMatrixBanner.toString() + ");\n";
}
