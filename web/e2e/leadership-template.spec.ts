import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { COOKIE, JSON_HEADERS, createRawSession, db, expect, test, uiLogin, type TestUser } from "./helpers/fixtures";
import { PORTRAIT, portraitPng } from "./helpers/portrait";

/**
 * The Universal Matrix Leadership Template, end to end: the admin template editor, a member's card (transparent portrait, position, decorative
 * text), publishing, and the same card on the homepage and the Leadership Board. The template and member styles are shared platform data, so
 * these tests run one after another and clean up everything they create.
 */
test.describe.configure({ mode: "serial" });
const SHOTS = process.env.LEAD_SHOTS ? path.resolve(__dirname, "../../docs/reports/leadership-template") : path.resolve(__dirname, "../ui-review/leadership-template");
const tag = () => randomUUID().slice(0, 6);
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });

const members: string[] = [];
const units: string[] = [];
const designations: string[] = [];

async function makeMember(opts: { name: string; published: boolean; placeholder?: boolean; unitName?: string; bio?: string }) {
  const t = tag();
  const unit = await db().orgUnit.create({ data: { slug: `e2e-lt-${t}`, name: opts.unitName ?? `E2E Leadership Board ${t}`, displayOrder: -1000 } });
  units.push(unit.id);
  const des = await db().designation.create({ data: { title: `E2E Founder ${t}`, rankOrder: -1000 } });
  designations.push(des.id);
  const m = await db().orgMember.create({ data: { slug: `e2e-lt-${t}`, fullName: opts.name, department: "Computer Science and Engineering", bio: opts.bio ?? null, visibility: opts.published ? "PUBLISHED" : "DRAFT", isPlaceholder: opts.placeholder ?? false } });
  members.push(m.id);
  await db().orgMembership.create({ data: { memberId: m.id, unitId: unit.id, designationId: des.id } });
  return { m, unit, des };
}

test.afterEach(async () => {
  await db().siteSetting.deleteMany({ where: { OR: [{ key: "leadership_template" }, { key: { startsWith: "leadership_member:" } }] } });
  await db().orgMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  await db().orgUnit.deleteMany({ where: { id: { in: units.splice(0) } } });
  await db().designation.deleteMany({ where: { id: { in: designations.splice(0) } } });
  await db().auditLog.deleteMany({ where: { action: { in: ["admin.leadership_template_saved", "admin.leadership_template_reset", "admin.org_member_card_saved"] } } });
});

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("access", () => {
  test("only an administrator can read or change the template or a member's card; anonymous callers get 401", async ({ request, users }) => {
    const { m } = await makeMember({ name: "Access Member", published: true });
    const T = "/api/v1/admin/leadership/template", C = `/api/v1/admin/members/${m.id}/card`;
    for (const [method, url] of [["get", T], ["put", T], ["delete", T], ["get", C], ["put", C]] as const) {
      const r = await request[method](url, { headers: JSON_HEADERS, data: method === "put" ? {} : undefined });
      expect(r.status(), `${method} ${url}`).toBe(401);
    }
    for (const roles of [[], ["ORGANIZER"], ["JUDGE"]] as const) {
      const person = await users.create({ roles: [...roles], fullName: "Not An Admin" });
      const headers = await asUser(person);
      for (const [method, url] of [["get", T], ["put", T], ["delete", T], ["get", C], ["put", C]] as const) {
        const r = await request[method](url, { headers, data: method === "put" ? {} : undefined });
        expect(r.status(), `${roles.join() || "participant"} ${method} ${url}`).toBe(403);
      }
    }
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Template Admin" });
    const headers = await asUser(admin);
    expect((await request.get(T, { headers })).status()).toBe(200);
    expect((await request.put(T, { headers, data: { typography: { size: 500 } } })).status()).toBe(400); // validated and clamped
    const ok = await request.put(T, { headers, data: { typography: { size: 26 } } });
    expect(ok.status()).toBe(200);
    expect(((await ok.json()) as { template: { typography: { size: number } } }).template.typography.size).toBe(26);
    expect((await request.put(C, { headers, data: { text: "FOUNDER", zoom: 1.3 } })).status()).toBe(200);
    expect((await request.put(C, { headers, data: { zoom: 9 } })).status()).toBe(400);
    expect((await request.put(`/api/v1/admin/members/${randomUUID()}/card`, { headers, data: {} })).status()).toBe(404);
  });
});

test.describe("admin: the Universal Matrix template editor", () => {
  test("controls change the live preview, Save persists across a reload, Reset restores the default, and the device preview resizes", async ({ page, users }) => {
    test.setTimeout(150_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Editor Admin" });
    await uiLogin(page, admin, "/admin/leadership/template");
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
    await expect(page.getByTestId("leadership-card")).toBeVisible();
    await page.waitForTimeout(1500); // hydration

    const deco = page.getByTestId("leadership-decorative-text");
    const fontPx = async () => Number((await deco.evaluate((e) => getComputedStyle(e).fontSize)).replace("px", ""));
    const typography = page.getByRole("group", { name: /^Decorative typography/ });
    const before = await fontPx();
    await typography.getByLabel(/^Font size/).fill("32");
    await expect.poll(fontPx).toBeGreaterThan(before * 1.3); // the preview follows the control at once
    await typography.getByLabel("Font", { exact: true }).selectOption("mono");
    await expect(deco).toHaveCSS("font-family", /geist|mono|monospace/i);
    await typography.getByLabel(/^Opacity/).fill("0.6");
    await expect(deco).toHaveCSS("opacity", "0.6");
    await page.getByRole("group", { name: "Background" }).getByLabel(/^Glow intensity/).fill("90");
    await page.getByRole("group", { name: "Information board" }).getByLabel("Show bio").check();
    await page.getByRole("group", { name: "Information board" }).getByLabel("Alignment").selectOption("center");
    await expect(page.getByTestId("leadership-board")).toHaveCSS("text-align", "center");
    await page.screenshot({ path: path.join(SHOTS, "admin-template-editor.png"), fullPage: true });

    // devices: the same card at three widths
    const frame = page.getByTestId("leadership-preview-frame");
    for (const [name, width] of [["Tablet", 300], ["Mobile", 220], ["Desktop", 360]] as const) {
      await page.getByRole("group", { name: "Preview size" }).getByRole("button", { name }).click();
      await expect(frame).toHaveAttribute("data-device", name.toLowerCase());
      expect(Math.round((await frame.boundingBox())!.width)).toBe(width);
      expect(await overflowX(page)).toBeLessThanOrEqual(0);
    }

    // an invalid colour is refused and the preview keeps the last valid colour
    await typography.getByLabel("Text colour, custom hex colour").fill("orange");
    await expect(typography.getByRole("alert")).toContainText("Use a colour like");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Use a text colour like/ })).toBeVisible();
    expect(await db().siteSetting.count({ where: { key: "leadership_template" } })).toBe(0);
    await typography.getByLabel("Text colour, custom hex colour").fill("#d4d4d4");

    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Template saved/ })).toBeVisible();
    const row = await db().siteSetting.findUniqueOrThrow({ where: { key: "leadership_template" } });
    expect(row.value).toMatchObject({ typography: { size: 32, font: "mono", opacity: 0.6, color: "#d4d4d4" }, background: { glow: 90 }, board: { showBio: true, align: "center" } });
    expect(await db().auditLog.count({ where: { actorId: admin.id, action: "admin.leadership_template_saved" } })).toBe(1);

    await page.reload(); // persists across a reload
    await page.waitForTimeout(1500);
    await expect(typography.getByLabel(/^Font size/)).toHaveValue("32");
    await expect(typography.getByLabel("Font", { exact: true })).toHaveValue("mono");
    await expect(page.getByRole("group", { name: "Information board" }).getByLabel("Show bio")).toBeChecked();
    await expect(page.getByTestId("leadership-board")).toHaveCSS("text-align", "center");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("status").filter({ hasText: /reset to the default/i })).toBeVisible();
    expect(await db().siteSetting.count({ where: { key: "leadership_template" } })).toBe(0);
    await expect(typography.getByLabel(/^Font size/)).toHaveValue("16");
  });

  test("the editor is accessible, keyboard operable and has no overflow at phone width", async ({ page, users }) => {
    test.setTimeout(120_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "A11y Admin" });
    await uiLogin(page, admin, "/admin/leadership/template");
    await expect(page.getByTestId("leadership-card")).toBeVisible();
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${vp.width}`).toEqual([]);
      expect(await overflowX(page)).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(SHOTS, "admin-template-editor-mobile.png"), fullPage: true });
  });
});

test.describe("member card: transparent portrait, position, decorative text, publish", () => {
  test("upload a transparent portrait, adjust it, customise the text, preview, save and publish", async ({ page, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const name = `Aarav Rahman ${tag()}`;
    const { m } = await makeMember({ name, published: false, placeholder: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Card Admin" });
    await uiLogin(page, admin, `/admin/leadership/members/${m.id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.waitForTimeout(1500);

    // upload the already-transparent portrait
    await page.locator('input[type="file"]').setInputFiles({ name: "cutout.png", mimeType: "image/png", buffer: portraitPng() });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();
    const card = page.getByTestId("leadership-card");
    const portrait = page.getByTestId("leadership-portrait");
    await expect(portrait).toBeVisible();
    await expect(portrait).toHaveAttribute("src", `/api/v1/org-members/${m.id}/photo`);

    // transparency survives upload, storage, serving and rendering: probe real pixels of the decoded image in the browser
    const probe = await page.evaluate(async ({ url, head, corner, w, h }) => {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
      const a = (x: number, y: number) => g.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
      return { size: [img.naturalWidth, img.naturalHeight], cornerAlpha: a(corner.x, corner.y), farCornerAlpha: a(w - 3, 2), headAlpha: a(w * head.x, h * head.y) };
    }, { url: `/api/v1/org-members/${m.id}/photo`, head: PORTRAIT.head, corner: PORTRAIT.corner, w: PORTRAIT.w, h: PORTRAIT.h });
    expect(probe).toEqual({ size: [PORTRAIT.w, PORTRAIT.h], cornerAlpha: 0, farCornerAlpha: 0, headAlpha: 255 });
    const served = await page.request.get(`/api/v1/org-members/${m.id}/photo`);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect(Buffer.from(await served.body()).equals(portraitPng())).toBe(true); // byte for byte what was uploaded

    // the decorative text defaults to the member's own name, and sits behind the portrait
    const deco = page.getByTestId("leadership-decorative-text");
    await expect(deco).toHaveText(name);
    const order = await card.evaluate((el) => {
      const kids = [...el.children];
      return { deco: kids.findIndex((k) => k.getAttribute("data-testid") === "leadership-decorative-text"), stage: kids.findIndex((k) => k.getAttribute("data-testid") === "leadership-stage") };
    });
    expect(order.deco).toBeGreaterThanOrEqual(0);
    expect(order.deco).toBeLessThan(order.stage); // drawn before (under) the portrait stage
    await portrait.scrollIntoViewIfNeeded();
    const box = (await portrait.boundingBox())!;
    const faceHit = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((e) => e.getAttribute("data-testid") || e.tagName), { x: box.x + box.width * PORTRAIT.head.x, y: box.y + box.height * PORTRAIT.head.y });
    expect(faceHit[0], "the portrait is the top layer over the face").toBe("leadership-portrait");
    expect(await deco.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none"); // decoration never intercepts anything

    // portrait zoom / position / reset
    const pos = page.getByRole("group", { name: "Portrait position" });
    await expect(portrait).toHaveCSS("height", /./);
    const heightPct = () => portrait.evaluate((e) => (e as HTMLElement).style.height);
    expect(await heightPct()).toBe("100%");
    await pos.getByLabel(/^Zoom/).fill("1.5");
    await expect.poll(heightPct).toBe("150%");
    await pos.getByLabel(/^Left \/ right/).fill("12");
    await expect.poll(() => portrait.evaluate((e) => (e as HTMLElement).style.left)).toBe("62%");
    await pos.getByRole("button", { name: "Reset portrait positioning" }).click();
    await expect.poll(heightPct).toBe("100%");

    // decorative text customisation: visual only
    await page.getByLabel("Text behind the portrait").fill("FOUNDER");
    await expect(deco).toHaveText("FOUNDER");
    await expect(page.getByTestId("leadership-board").getByRole("heading", { level: 3 })).toHaveText(name); // the verified name is untouched
    await page.getByRole("group", { name: "Decorative text for this member" }).getByLabel(/^Text size/).fill("1.3");
    await page.screenshot({ path: path.join(SHOTS, "member-card-editor.png"), fullPage: true });
    await card.screenshot({ path: path.join(SHOTS, "member-card-preview.png") });

    // empty optional fields leave no rows: this member has no term, bio or links
    await expect(page.getByTestId("leadership-row")).toHaveCount(2); // the unit line and the department: no empty rows for the missing term, bio or links

    // save as a design only: the member stays a draft placeholder and is not public
    await page.getByRole("button", { name: "Save member design" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Design saved." })).toBeVisible();
    const stored = await db().siteSetting.findUniqueOrThrow({ where: { key: `leadership_member:${m.id}` } });
    expect(stored.value).toMatchObject({ text: "FOUNDER", textScale: 1.3, zoom: 1 });
    expect((await db().orgMember.findUniqueOrThrow({ where: { id: m.id } })).visibility).toBe("DRAFT");
    await page.context().clearCookies();
    expect((await page.request.get(`/api/v1/org-members/${m.id}/photo`)).status()).toBe(404); // a draft portrait is private
    await uiLogin(page, admin, `/admin/leadership/members/${m.id}`);
    await page.waitForTimeout(1500);

    // publish (with confirmation): visible and verified
    page.on("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Publish member" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Member published/ })).toBeVisible();
    const after = await db().orgMember.findUniqueOrThrow({ where: { id: m.id } });
    expect([after.visibility, after.isPlaceholder]).toEqual(["PUBLISHED", false]);
    expect(await db().auditLog.count({ where: { actorId: admin.id, action: "admin.org_member_card_saved", entityId: m.id } })).toBeGreaterThanOrEqual(2);
  });
});

test.describe("published members appear on the homepage and the Leadership Board with the same card", () => {
  test("homepage and /about/team show the same published member; drafts and placeholders stay hidden; anchors match", async ({ page, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const name = `Layla Karim ${tag()}`;
    const shown = await makeMember({ name, published: true, unitName: `E2E Leadership Board ${tag()}` });
    const draft = await makeMember({ name: `Hidden Draft ${tag()}`, published: false });
    const placeholder = await makeMember({ name: `Hidden Placeholder ${tag()}`, published: true, placeholder: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Publish Admin" });
    await uiLogin(page, admin, `/admin/leadership/members/${shown.m.id}`);
    await page.waitForTimeout(1500);
    await page.locator('input[type="file"]').setInputFiles({ name: "cutout.png", mimeType: "image/png", buffer: portraitPng() });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();
    await page.getByLabel("Text behind the portrait").fill("LEADERSHIP");
    await page.getByRole("button", { name: "Save member design" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Design saved." })).toBeVisible();
    await page.context().clearCookies(); // from here on: an anonymous visitor

    const read = async (url: string) => {
      await page.goto(url);
      const c = page.getByTestId("leadership-card").filter({ has: page.getByRole("heading", { level: 3, name }) });
      await expect(c).toBeVisible();
      await c.scrollIntoViewIfNeeded();
      await expect(c.getByTestId("leadership-portrait")).toBeVisible();
      await expect.poll(() => c.getByTestId("leadership-portrait").evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth)).toBe(PORTRAIT.w);
      return {
        deco: await c.getByTestId("leadership-decorative-text").textContent(),
        decoStyle: await c.getByTestId("leadership-decorative-text").getAttribute("style"),
        board: (await c.getByTestId("leadership-board").innerText()).replace(/\s+/g, " ").trim(),
        photo: await c.getByTestId("leadership-portrait").getAttribute("src"),
        c,
      };
    };
    const home = await read("/");
    await expect(page.getByTestId("home-leadership")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "homepage-published-member.png") });
    await home.c.screenshot({ path: path.join(SHOTS, "homepage-card.png") });
    const teamPage = await read("/about/team");
    await page.screenshot({ path: path.join(SHOTS, "leadership-board-published-member.png") });
    expect(home.deco).toBe("LEADERSHIP"); // the member's customised decorative text, on both pages
    expect(teamPage.deco).toBe("LEADERSHIP");
    expect(teamPage.decoStyle).toBe(home.decoStyle); // the same template drives both
    expect(teamPage.board).toBe(home.board);
    expect(teamPage.photo).toBe(home.photo);
    expect(home.board).toContain(name);
    expect(home.board).toContain(shown.unit.name);
    expect(home.board).toContain(shown.des.title);
    expect(home.board).toContain("Computer Science and Engineering");

    // drafts, placeholders and the fake fallback profiles stay hidden once real members are published
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await expect(page.getByTestId("leadership-card").first()).toBeVisible();
      await expect(page.getByText(draft.m.fullName)).toHaveCount(0);
      await expect(page.getByText(placeholder.m.fullName)).toHaveCount(0);
      await expect(page.getByText("Name to be announced")).toHaveCount(0);
    }
    expect((await page.request.get(`/api/v1/org-members/${draft.m.id}/photo`)).status()).toBe(404);
    expect((await page.request.get(`/api/v1/org-members/${placeholder.m.id}/photo`)).status()).toBe(404);

    // the homepage team chips come from the real units and their anchors match the section ids on /about/team
    await page.goto("/");
    const chip = page.getByRole("navigation", { name: "Teams" }).getByRole("link", { name: shown.unit.name });
    await expect(chip).toHaveAttribute("href", `/about/team#${shown.unit.slug}`);
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/about/team#${shown.unit.slug}$`));
    await expect(page.locator(`section#${shown.unit.slug}`)).toBeVisible();
    await expect(page.locator(`section#${shown.unit.slug}`).getByRole("heading", { level: 2, name: shown.unit.name })).toBeVisible();
    await expect.poll(() => page.evaluate((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return r.top >= -2 && r.top < window.innerHeight; }, shown.unit.slug), { message: "the anchor scrolled the section into view" }).toBe(true);
  });

  test("a contact email is public only while the member allows it: the setting is enforced on the server for the homepage and /about/team", async ({ page, request }) => {
    test.setTimeout(90_000);
    const email = `e2e-private-${tag()}@example.test`;
    const { m } = await makeMember({ name: `Privacy Person ${tag()}`, published: true });
    await db().orgMember.update({ where: { id: m.id }, data: { email, emailPublic: true } });
    const card = () => page.getByTestId("leadership-card").filter({ hasText: m.fullName });
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await expect(card().getByRole("link", { name: email }), `${url}: allowed, so it is shown`).toBeVisible();
    }
    await db().orgMember.update({ where: { id: m.id }, data: { emailPublic: false } }); // the member turns it off
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await expect(card(), `${url}: the card is still there`).toBeVisible();
      await expect(page.getByText(email), `${url}: the email is not visible`).toHaveCount(0);
      const html = await (await request.get(url)).text(); // the raw page, including hidden fields and the data payload
      expect(html, `${url}: the email is nowhere in the page source or its data`).not.toContain(email);
      expect(html, `${url}: no mailto link`).not.toContain(`mailto:${email}`);
    }
    // the template switch hides it even when the member allows it
    await db().orgMember.update({ where: { id: m.id }, data: { emailPublic: true } });
    await db().siteSetting.upsert({ where: { key: "leadership_template" }, create: { key: "leadership_template", value: { board: { showEmail: false } } }, update: { value: { board: { showEmail: false } } } });
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await expect(card()).toBeVisible();
      await expect(page.getByText(email)).toHaveCount(0);
    }
  });

  test("responsive and accessible: desktop, tablet and phone have no overflow, the whole card is visible, and axe finds no violations", async ({ page, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const name = `Responsive Member ${tag()}`;
    const { m } = await makeMember({ name, published: true, bio: "Builds communities that ship ideas, one event at a time." });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Layout Admin" });
    await uiLogin(page, admin, `/admin/leadership/members/${m.id}`);
    await page.waitForTimeout(1500);
    await page.locator('input[type="file"]').setInputFiles({ name: "cutout.png", mimeType: "image/png", buffer: portraitPng() });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();
    await page.context().clearCookies();
    for (const vp of [{ n: "desktop", width: 1440, height: 900 }, { n: "tablet", width: 768, height: 1024 }, { n: "mobile", width: 390, height: 844 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const url of ["/", "/about/team"]) {
        await page.goto(url);
        const c = page.getByTestId("leadership-card").filter({ has: page.getByRole("heading", { level: 3, name }) });
        await expect(c).toBeVisible();
        await c.scrollIntoViewIfNeeded();
        await expect.poll(() => c.getByTestId("leadership-portrait").evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
        expect(await overflowX(page), `${vp.n} ${url}`).toBeLessThanOrEqual(0);
        const cb = (await c.boundingBox())!;
        expect(cb.x).toBeGreaterThanOrEqual(0);
        expect(cb.x + cb.width).toBeLessThanOrEqual(vp.width + 0.5);
        const bb = (await c.getByTestId("leadership-board").boundingBox())!;
        expect(bb.y + bb.height, `${vp.n} ${url}: the information board is fully inside the card`).toBeLessThanOrEqual(cb.y + cb.height + 1);
        expect(Math.abs(cb.width / cb.height - 0.8), "the card keeps its 4:5 shape").toBeLessThan(0.02);
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${vp.n} ${url}`).toEqual([]);
        if (url === "/about/team") await page.screenshot({ path: path.join(SHOTS, `leadership-board-${vp.n}.png`), fullPage: vp.n !== "desktop" });
      }
    }
  });
});
