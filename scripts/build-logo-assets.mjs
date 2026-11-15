/**
 * Builds derivative logo files from the ORIGINAL artwork (assets/branding/1.png).
 * The original is read-only input and is never modified. No redesign: only
 * (a) background -> transparency, (b) cropping/padding, (c) resizing.
 *
 * Transparency method: the artwork is white/silver on pure black, so each pixel's
 * alpha is its brightness and the color is un-premultiplied. On a dark background the
 * result is visually identical to the original; it is intended for dark backgrounds only.
 *
 * Usage (from D:\ShadowTrix\web):  npm run logo:build
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "web", "package.json"));
const sharp = require("sharp");

const SRC = path.join(root, "assets", "branding", "1.png");
const OUT = path.join(root, "assets", "branding", "derived");
const WEB_PUBLIC = path.join(root, "web", "public", "brand");
const WEB_APP = path.join(root, "web", "src", "app");

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

// 1) background -> alpha
const rgba = Buffer.alloc(width * height * 4);
let minX = width, minY = height, maxX = -1, maxY = -1;
const ALPHA_FLOOR = 12; // ignore near-black noise when finding the bounding box
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = Math.max(r, g, b);
    if (a > 0) {
      rgba[i] = Math.min(255, Math.round((r * 255) / a));
      rgba[i + 1] = Math.min(255, Math.round((g * 255) / a));
      rgba[i + 2] = Math.min(255, Math.round((b * 255) / a));
    }
    rgba[i + 3] = a < 4 ? 0 : a; // fully clear the pure-black field (JPEG-ish noise floor)
    if (a > ALPHA_FLOOR) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const full = sharp(rgba, { raw: { width, height, channels: 4 } });
const fullPng = await full.png().toBuffer();

// 2) crop to content, then pad to a square with 6% margin
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const side = Math.round(Math.max(cw, ch) * 1.12);
const cropped = await sharp(fullPng)
  .extract({ left: minX, top: minY, width: cw, height: ch })
  .extend({
    top: Math.floor((side - ch) / 2),
    bottom: Math.ceil((side - ch) / 2),
    left: Math.floor((side - cw) / 2),
    right: Math.ceil((side - cw) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

// 3) opaque-black icons (favicons must be legible on light and dark browser chrome)
const icon = (size, markRatio = 0.86) =>
  sharp(cropped)
    .resize(Math.round(size * markRatio), Math.round(size * markRatio), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.floor((size - Math.round(size * markRatio)) / 2),
      bottom: Math.ceil((size - Math.round(size * markRatio)) / 2),
      left: Math.floor((size - Math.round(size * markRatio)) / 2),
      right: Math.ceil((size - Math.round(size * markRatio)) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .flatten({ background: "#000000" })
    .png()
    .toBuffer();

await mkdir(OUT, { recursive: true });
await mkdir(WEB_PUBLIC, { recursive: true });

const files = {
  "logo-transparent-full.png": fullPng,
  "logo-mark-transparent.png": cropped,
  "icon-16.png": await icon(16, 0.94),
  "icon-32.png": await icon(32, 0.94),
  "icon-48.png": await icon(48, 0.92),
  "icon-192.png": await icon(192),
  "icon-512.png": await icon(512),
  "apple-touch-icon-180.png": await icon(180, 0.8),
};
for (const [name, buf] of Object.entries(files)) await writeFile(path.join(OUT, name), buf);

// favicon.ico containing 16/32/48 PNG images
const sizes = [16, 32, 48];
const imgs = sizes.map((s) => files[`icon-${s}.png`]);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
let offset = 6 + 16 * imgs.length;
const entries = imgs.map((img, i) => {
  const e = Buffer.alloc(16);
  e[0] = sizes[i]; e[1] = sizes[i]; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
const ico = Buffer.concat([header, ...entries, ...imgs]);
await writeFile(path.join(OUT, "favicon.ico"), ico);

// social share card (Open Graph / Twitter): the unmodified mark centered on pure black, 1200x630
const markForCard = await sharp(cropped).resize(520, 520, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
const card = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#000000" } })
  .composite([{ input: markForCard, gravity: "center" }])
  .png()
  .toBuffer();
await writeFile(path.join(OUT, "social-card-1200x630.png"), card);

// copy what the web app serves
await copyFile(path.join(OUT, "icon-192.png"), path.join(WEB_PUBLIC, "icon-192.png"));
await copyFile(path.join(OUT, "icon-512.png"), path.join(WEB_PUBLIC, "icon-512.png"));
await writeFile(path.join(WEB_APP, "opengraph-image.png"), card);
await writeFile(path.join(WEB_APP, "twitter-image.png"), card);
await writeFile(path.join(WEB_APP, "opengraph-image.alt.txt"), "ShadowTrix logo: a network globe inside a hexagon, on a black background");
await writeFile(path.join(WEB_APP, "twitter-image.alt.txt"), "ShadowTrix logo: a network globe inside a hexagon, on a black background");
await copyFile(path.join(OUT, "logo-mark-transparent.png"), path.join(WEB_PUBLIC, "logo-mark.png"));
await copyFile(path.join(OUT, "favicon.ico"), path.join(WEB_APP, "favicon.ico"));
await copyFile(path.join(OUT, "icon-512.png"), path.join(WEB_APP, "icon.png"));
await copyFile(path.join(OUT, "apple-touch-icon-180.png"), path.join(WEB_APP, "apple-icon.png"));

console.log(`Source ${width}x${height}; content bbox ${cw}x${ch} at (${minX},${minY}); mark square ${side}px.`);
console.log("Wrote:", Object.keys(files).concat("favicon.ico").join(", "));
