import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const VIEWPORTS = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SHOTS = path.resolve(__dirname, "../../docs/design/screenshots");

/** Animations are finished/disabled so axe and screenshots see final colors, not mid-fade values. */
async function settled(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // Readable failure output
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary).toEqual([]);
}

test.describe("homepage across breakpoints", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: no horizontal overflow, no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await settled(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal scroll").toBeLessThanOrEqual(0);

      await axe(page);

      if (process.env.SCREENSHOTS) {
        await page.screenshot({ path: path.join(SHOTS, `home-${vp.name}.png`), fullPage: true });
        await page.screenshot({ path: path.join(SHOTS, `home-${vp.name}-fold.png`) });
      }
    });
  }

  test("axe also passes with animations enabled (after they finish)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1800);
    await axe(page);
  });

  test("touch targets in the mobile header are at least 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const box = await page.goto("/").then(() => page.getByRole("button", { name: "Open menu" }).boundingBox());
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("structure, SEO and audit requirements", () => {
  test("landmarks, single h1, heading order, language", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeAttached();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // heading levels never skip downward (h1 -> h2 -> h3 ...)
    const levels = await page.$$eval("h1,h2,h3,h4,h5,h6", (hs) => hs.map((h) => Number(h.tagName[1])));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading order at index ${i}`).toBeLessThanOrEqual(1);
  });

  test("hero headline exists exactly once in the DOM text and is selectable", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Enter the Matrix of Innovation.");
    const occurrences = await page.evaluate(() => (document.body.innerText.match(/Enter the Matrix of Innovation\./g) ?? []).length);
    expect(occurrences).toBe(1);
    // nothing hidden duplicates it for assistive tech
    expect(await page.locator("[aria-hidden='true']", { hasText: "Matrix of Innovation" }).count()).toBe(0);
    expect(await page.locator(".sr-only", { hasText: "Matrix of Innovation" }).count()).toBe(0);
    expect(await h1.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
  });

  test("hero has exactly one primary and one secondary action; login lives in the navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const hero = page.locator("section[aria-labelledby='hero-title']");
    const links = hero.getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText("Explore Events");
    await expect(links.nth(1)).toHaveText("Join ShadowTrix");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Events" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
    await expect(hero.getByRole("link", { name: /login|member portal/i })).toHaveCount(0);
  });

  test("metadata: title, description, canonical, Open Graph and Twitter", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ShadowTrix/);
    const meta = (sel: string) => page.locator(sel).first().getAttribute("content");
    expect(await meta("meta[name='description']")).toContain("Discover competitions");
    expect(await meta("meta[property='og:title']")).toContain("ShadowTrix");
    expect(await meta("meta[property='og:image']")).toMatch(/opengraph-image/);
    expect(await meta("meta[property='og:type']")).toBe("website");
    expect(await meta("meta[name='twitter:card']")).toBe("summary_large_image");
    expect(await meta("meta[name='twitter:image']")).toMatch(/twitter-image/);
    expect(await page.locator("link[rel='canonical']").getAttribute("href")).toBeTruthy();
    const jsonLd = JSON.parse((await page.locator("script[type='application/ld+json']").textContent())!);
    expect(jsonLd["@type"]).toBe("Organization");
  });

  test("social image, icons and manifest are served", async ({ request }) => {
    for (const url of ["/opengraph-image.png", "/twitter-image.png", "/icon.png", "/apple-icon.png", "/favicon.ico", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml"]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(200);
    }
  });

  test("every internal link on the homepage resolves (no broken URLs)", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")!));
    const internal = [...new Set(hrefs.filter((h) => h.startsWith("/")).map((h) => h.split("#")[0].split("?")[0] || "/"))];
    expect(internal.length).toBeGreaterThan(5);
    for (const href of internal) {
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
    }
    // in-page anchors used for team groups point to routes that exist
    expect(hrefs.some((h) => h.startsWith("mailto:") || h.startsWith("http"))).toBe(false);
  });

  test("placeholder pages are not indexable", async ({ page }) => {
    for (const route of ["/about", "/about/team", "/community", "/contact", "/login", "/register"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
      expect(await page.locator("meta[name='robots']").getAttribute("content"), route).toContain("noindex");
    }
  });

  test("demonstration content is always labelled", async ({ page }) => {
    await page.goto("/");
    // every event card carries a visible Sample badge
    const cards = page.locator("article").filter({ has: page.getByRole("heading", { level: 3 }) });
    const eventCards = page.locator("article:has(dl)");
    const n = await eventCards.count();
    expect(n).toBe(6);
    for (let i = 0; i < n; i++) await expect(eventCards.nth(i).getByText("Sample", { exact: true })).toBeVisible();
    // every leadership card is marked as a placeholder, and no real-looking names appear
    const profiles = page.locator("article:has-text('Placeholder profile')");
    expect(await profiles.count()).toBe(4);
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
    // one notice above each block of sample content: featured events, timeline example, leadership, previous events
    await expect(page.getByRole("note")).toHaveCount(4);
    expect(await page.locator("body").innerText()).not.toMatch(/lorem|ipsum/i);
  });

  test("images are loaded and have an alt attribute", async ({ page }) => {
    await page.goto("/");
    // scroll the whole page so lazy-loaded images (e.g. the footer logo) are requested
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, document.body.scrollHeight); // ensure the very bottom (footer) is reached
      await new Promise((r) => setTimeout(r, 200));
    });
    const state = () =>
      page.$$eval("img", (els) => els.map((i) => ({ alt: i.getAttribute("alt"), ok: i.complete && i.naturalWidth > 0, src: i.currentSrc })));
    expect((await state()).length).toBeGreaterThan(0);
    // Wait for the condition rather than sampling once: lazy images finish loading a moment after they are scrolled into view.
    await expect.poll(async () => (await state()).filter((i) => !i.ok).map((i) => i.src), { timeout: 15_000 }).toEqual([]);
    for (const i of await state()) expect(i.alt, i.src).not.toBeNull();
  });
});

test.describe("keyboard and assistive technology", () => {
  test("skip link is the first tab stop and moves focus to main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("desktop: About Us menu opens with the keyboard and reaches Our Team", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "About Us" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: /Our Team/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: /Our Team/ })).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // opening with the keyboard focuses the first item ("About ShadowTrix"); one ArrowDown reaches "Our Team"
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: /About ShadowTrix/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: /Our Team/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/about\/team$/);
    await expect(page.getByRole("link", { name: "Events" }).first()).not.toHaveAttribute("aria-current", "page");
  });

  test("mobile: menu is a dialog with focus trap, Escape to close and focus return", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    const open = page.getByRole("button", { name: "Open menu" });
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Our Team" })).toBeVisible();
    // focus stays inside the dialog while tabbing
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await page.getByRole("dialog").getByRole("link", { name: "Our Team" }).click();
    await expect(page).toHaveURL(/\/about\/team$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("current page is exposed with aria-current", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/events");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "page");
  });

  test("every interactive control shows a visible focus indicator", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        return { w: parseFloat(s.outlineWidth), style: s.outlineStyle, tag: el.tagName };
      });
      expect(outline.style, `tab stop ${i} <${outline.tag}>`).not.toBe("none");
      expect(outline.w).toBeGreaterThanOrEqual(2);
    }
  });

  test("reduced motion: hero text is visible immediately and nothing loops", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const word = page.getByRole("heading", { level: 1 }).locator("span span").first();
    expect(Number(await word.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
    const durations = await page.$$eval("*", (els) =>
      els.map((e) => getComputedStyle(e)).filter((s) => s.animationName !== "none").map((s) => parseFloat(s.animationDuration)),
    );
    for (const d of durations) expect(d).toBeLessThan(0.01);
  });
});

test.describe("design system reference page", () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`${vp.name}: renders every component without axe violations or overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await settled(page);
      await page.goto("/design-system");
      await expect(page.getByRole("heading", { level: 1, name: "ShadowTrix design system" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await axe(page);
      if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(SHOTS, `design-system-${vp.name}.png`), fullPage: true });
    });
  }

  test("form errors are announced and linked to their field", async ({ page }) => {
    await page.goto("/design-system");
    const email = page.getByLabel(/^Email/);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const describedBy = await email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText("name@example.com");
    // (Next.js also renders its own route-announcer alert, so scope to the form)
    await expect(page.locator("form").getByRole("alert")).toContainText("name@example.com");
  });
});
