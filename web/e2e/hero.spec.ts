import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./helpers/fixtures";

const OUT = path.resolve(__dirname, "../ui-review/hero");
const WORDS = ["Innovation", "Creativity", "Technology", "Possibilities", "The Future"];

/** Records every distinct value of the animated word (with timestamps) for `ms` milliseconds, inside the page. */
async function record(page: import("@playwright/test").Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<{ t: number; text: string; caret: boolean }[]>((resolve) => {
        const el = document.querySelector("#hero-title .hero-word")!;
        const out: { t: number; text: string; caret: boolean }[] = [];
        const t0 = performance.now();
        const snap = () => out.push({ t: performance.now() - t0, text: el.textContent ?? "", caret: !!document.querySelector("#hero-title .hero-caret") });
        snap();
        const mo = new MutationObserver(snap);
        mo.observe(el, { childList: true, characterData: true, subtree: true });
        setTimeout(() => { mo.disconnect(); resolve(out); }, duration);
      }),
    ms,
  );
}

test.describe("hero typewriter headline", () => {
  test("types letter by letter, holds, deletes letter by letter, then cycles through every word", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator("#hero-title .hero-word")).toHaveText("Innovation"); // server-rendered first word
    await expect(page.locator("#hero-title .hero-caret")).toBeVisible(); // hydrated and animating: the server-rendered frame has no caret by design
    const frames = await record(page, 26_000);
    const texts = frames.map((f) => f.text);

    // every step changes the text by exactly one letter (no jumps), in both directions
    let typed = 0, deleted = 0;
    for (let i = 1; i < texts.length; i++) {
      const a = texts[i - 1], b = texts[i];
      if (b.length === a.length + 1 && b.startsWith(a)) typed++;
      else if (b.length === a.length - 1 && a.startsWith(b)) deleted++;
      else if (a === "" || b === "") continue;
      else if (a.length === 0 && b.length === 1) typed++;
      else throw new Error(`unexpected jump "${a}" -> "${b}"`);
    }
    expect(typed).toBeGreaterThan(15);
    expect(deleted).toBeGreaterThan(15);
    // a complete word rests (hold), the word becomes empty, and all five words appear in full
    for (const w of WORDS) expect(texts, `word ${w}`).toContain(w);
    expect(texts).toContain("");
    // natural speed: typing a letter takes roughly 60-120 ms, deleting about 30-70 ms (median over the run)
    const gaps = (dir: 1 | -1) => frames.slice(1).map((f, i) => ({ d: f.text.length - frames[i].text.length, dt: f.t - frames[i].t })).filter((x) => x.d === dir).map((x) => x.dt).sort((a, b) => a - b);
    const med = (a: number[]) => a[Math.floor(a.length / 2)];
    expect(med(gaps(1))).toBeGreaterThan(55);
    expect(med(gaps(1))).toBeLessThan(140);
    expect(med(gaps(-1))).toBeGreaterThan(30);
    expect(med(gaps(-1))).toBeLessThan(med(gaps(1))); // deleting is faster than typing
    // a cursor is always present while animating
    expect(frames.every((f) => f.caret)).toBe(true);
  });

  test("no layout shift while the word changes; the heading name is constant; nothing is clipped", async ({ page }) => {
    test.setTimeout(60_000);
    for (const vp of [{ w: 1440, h: 900 }, { w: 820, h: 1100 }, { w: 390, h: 844 }, { w: 320, h: 700 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/");
      await expect(page.locator("#hero-title .hero-word")).toBeVisible();
      await page.waitForTimeout(1500); // let the one-off entrance reveal of the buttons finish before measuring
      const samples = await page.evaluate(
        () =>
          new Promise<{ h1h: number; ctaTop: number; word: string; name: string; overflow: number; wordRight: number; h1Right: number }[]>((resolve) => {
            const out: { h1h: number; ctaTop: number; word: string; name: string; overflow: number; wordRight: number; h1Right: number }[] = [];
            const h1 = document.querySelector("#hero-title") as HTMLElement;
            const cta = document.querySelector("section[aria-labelledby='hero-title'] a[href='/events']") as HTMLElement;
            const w = document.querySelector("#hero-title .hero-word") as HTMLElement;
            const id = setInterval(() => {
              out.push({
                h1h: Math.round(h1.getBoundingClientRect().height), ctaTop: Math.round(cta.getBoundingClientRect().top + scrollY), word: w.textContent ?? "",
                name: h1.querySelector(".sr-only")!.textContent ?? "", overflow: document.documentElement.scrollWidth - innerWidth,
                wordRight: Math.round(w.getBoundingClientRect().right), h1Right: Math.round(h1.getBoundingClientRect().right),
              });
            }, 60);
            setTimeout(() => { clearInterval(id); resolve(out); }, 9000);
          }),
      );
      const label = `${vp.w}px`;
      expect(new Set(samples.map((s) => s.h1h)).size, `${label} heading height changes`).toBe(1);
      expect(new Set(samples.map((s) => s.ctaTop)).size, `${label} button position changes`).toBe(1);
      expect(new Set(samples.map((s) => s.name)).size, `${label} accessible text changes`).toBe(1);
      expect(Math.max(...samples.map((s) => s.overflow)), `${label} horizontal overflow`).toBeLessThanOrEqual(0);
      expect(Math.max(...samples.map((s) => s.wordRight - s.h1Right)), `${label} word clipped`).toBeLessThanOrEqual(1);
      expect(new Set(samples.map((s) => s.word)).size, `${label} animated`).toBeGreaterThan(5);
    }
  });

  test("reduced motion: a stable static headline, no cursor, no typing", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const word = page.locator("#hero-title .hero-word");
    await expect(word).toHaveText("Innovation");
    const frames = await record(page, 4_000);
    expect(new Set(frames.map((f) => f.text))).toEqual(new Set(["Innovation"]));
    await expect(page.locator("#hero-title .hero-caret")).toHaveCount(0);
  });

  test("the call-to-action links still work", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("section[aria-labelledby='hero-title']");
    await expect(hero.getByRole("link", { name: "Explore Events" })).toHaveAttribute("href", "/events");
    await expect(hero.getByRole("link", { name: "Join ShadowTrix" })).toHaveAttribute("href", "/register");
    await expect(hero.getByText("Events by Team EU Shadow")).toBeVisible();
    await expect(hero.getByText("Discover competitions, connect with innovators, and turn your ideas into reality.")).toBeVisible();
  });

  test("captures for visual review", async ({ page }) => {
    test.setTimeout(60_000);
    fs.mkdirSync(OUT, { recursive: true });
    for (const vp of [{ n: "desktop", w: 1440, h: 900 }, { n: "tablet", w: 820, h: 1100 }, { n: "phone", w: 390, h: 844 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/");
      const h1 = page.locator("#hero-title");
      await expect(h1).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `hero-${vp.n}-first.png`), clip: { x: 0, y: 0, width: vp.w, height: Math.min(vp.h, 760) } });
      // wait for a half-typed state of a later word
      await page.waitForFunction(() => { const t = document.querySelector("#hero-title .hero-word")?.textContent ?? ""; return t.length >= 3 && t.length <= 6 && t !== "Inno" && !"Innovation".startsWith(t); }, null, { timeout: 20_000 });
      await page.screenshot({ path: path.join(OUT, `hero-${vp.n}-typing.png`), clip: { x: 0, y: 0, width: vp.w, height: Math.min(vp.h, 760) } });
    }
  });
});

test("capture the category cards for visual review", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const vp of [{ n: "desktop", w: 1440, h: 900 }, { n: "phone", w: 390, h: 844 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    const sec = page.locator("section[aria-labelledby='categories-title']");
    await sec.scrollIntoViewIfNeeded();
    await sec.locator("ul").first().locator("li").nth(1).hover();
    await page.waitForTimeout(500);
    await sec.locator("ul").first().screenshot({ path: path.join(OUT, `categories-${vp.n}.png`) });
  }
});
