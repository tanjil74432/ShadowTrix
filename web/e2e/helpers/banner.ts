import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Shared by the banner browser tests. */

/** A synthetic 3000 x 2000 "photo" made in the page, so the test needs no image file and exercises the downscale path. */
export async function fakePhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 3000; c.height = 2000;
    const g = c.getContext("2d")!;
    const bg = g.createLinearGradient(0, 0, 3000, 2000);
    bg.addColorStop(0, "#3a4a63"); bg.addColorStop(1, "#8a97ad");
    g.fillStyle = bg; g.fillRect(0, 0, 3000, 2000);
    g.fillStyle = "#c9a384"; g.beginPath(); g.arc(1500, 700, 330, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1f2733"; g.beginPath(); g.ellipse(1500, 1900, 760, 700, 0, Math.PI, 0); g.fill();
    return c.toDataURL("image/jpeg", 0.9);
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Adds the synthetic photo and waits until the editor has accepted it; retries because the first attempt can land before the page has hydrated. */
export async function addPhoto(page: Page) {
  const buffer = await fakePhoto(page);
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
    if (await page.getByText("Drag the preview to reposition the portrait.").isVisible({ timeout: 2500 }).catch(() => false)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("the editor never accepted the portrait");
}

/** Waits until the page font is loaded in every weight the banner uses and the repaint that follows has run, so a snapshot of the preview is final. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const family = getComputedStyle(document.body).fontFamily;
    // Each load is allowed to fail on its own: next/font adds a fallback face that needs a locally installed font (absent on the Linux CI runner), and a face that cannot load rejects with a NetworkError. The page and the editor fall back to the next font in the list, so only the wait matters here.
    await Promise.all([500, 600, 700, 800].map((w) => document.fonts.load(`${w} 24px ${family}`).catch(() => [])));
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(200);
}

/**
 * Pixel comparison of two PNG data URLs, done in the browser. Chromium can rasterise the canvas on the GPU or the CPU (it may switch after
 * repeated pixel read-backs), which moves a handful of anti-aliased pixels by one level out of 255; that is invisible, so "the same picture"
 * means: no channel differs by more than 2 and fewer than 0.05% of the pixels differ at all.
 */
export async function samePicture(page: Page, a: string, b: string) {
  const d = await page.evaluate(async ([x, y]) => {
    const load = async (u: string) => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d")!; g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const A = await load(x), B = await load(y);
    if (A.width !== B.width || A.height !== B.height) return { n: 1, maxd: 255, total: 1 };
    let n = 0, maxd = 0;
    for (let i = 0; i < A.data.length; i += 4) { const m = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]), Math.abs(A.data[i + 3] - B.data[i + 3])); if (m) { n++; if (m > maxd) maxd = m; } }
    return { n, maxd, total: A.width * A.height };
  }, [a, b]);
  return d.maxd <= 2 && d.n / d.total < 0.0005;
}

/** The downloaded file is exactly what the canvas holds after the download, and is the same picture as the preview seen before it. */
export async function expectExportMatches(page: Page, canvas: Locator, previewDataUrl: string, file: Buffer) {
  const after = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
  expect(file.equals(Buffer.from(after.split(",")[1], "base64"))).toBe(true);
  expect(await samePicture(page, previewDataUrl, "data:image/png;base64," + file.toString("base64"))).toBe(true);
}

export function pngSize(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
