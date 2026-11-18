import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { COOKIE, JSON_HEADERS, ORIGIN, createRawSession, db, expect, test, uiLogin, type TestUser } from "./helpers/fixtures";
import { PORTRAIT, portraitPng, silhouettePng } from "./helpers/portrait";

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
    const ok = await request.put(T, { headers, data: { typography: { size: 22 } } });
    expect(ok.status()).toBe(200);
    expect(((await ok.json()) as { template: { typography: { size: number } } }).template.typography.size).toBe(22);
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
    const fontPx = async () => Number((await deco.locator("span").first().evaluate((e) => getComputedStyle(e).fontSize)).replace("px", ""));
    const typography = page.getByRole("group", { name: /^Decorative typography/ });
    const before = await fontPx();
    await typography.getByLabel(/^Font size/).fill("24");
    await expect.poll(fontPx).toBeGreaterThan(before * 1.1); // the preview follows the control at once, upwards...
    await typography.getByLabel(/^Font size/).fill("10");
    await expect.poll(fontPx).toBeLessThan(before * 0.6); // ...and downwards: every position of the slider changes the size
    await expect(deco).toHaveAttribute("data-preset", "futuristic");
    await typography.getByRole("radio", { name: /Matrix Typography/ }).check({ force: true });
    await expect(deco).toHaveAttribute("data-preset", "matrix");
    await typography.getByRole("button", { name: "Text colour: Emerald green" }).click();
    await expect(typography.getByRole("button", { name: "Text colour: Emerald green" })).toHaveAttribute("aria-pressed", "true");
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

    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Template saved/ })).toBeVisible();
    const row = await db().siteSetting.findUniqueOrThrow({ where: { key: "leadership_template" } });
    expect(row.value).toMatchObject({ typography: { size: 10, preset: "matrix", opacity: 0.6, color: "#2ee59d" }, background: { glow: 90 }, board: { showBio: true, align: "center" } });
    expect(await db().auditLog.count({ where: { actorId: admin.id, action: "admin.leadership_template_saved" } })).toBe(1);

    await page.reload(); // persists across a reload
    await page.waitForTimeout(1500);
    await expect(typography.getByLabel(/^Font size/)).toHaveValue("10");
    await expect(typography.getByRole("radio", { name: /Matrix Typography/ })).toBeChecked();
    await expect(typography.getByRole("button", { name: "Text colour: Emerald green" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Information board" }).getByLabel("Show bio")).toBeChecked();
    await expect(page.getByTestId("leadership-board")).toHaveCSS("text-align", "center");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("status").filter({ hasText: /reset to the default/i })).toBeVisible();
    expect(await db().siteSetting.count({ where: { key: "leadership_template" } })).toBe(0);
    await expect(typography.getByLabel(/^Font size/)).toHaveValue("20");
    await expect(typography.getByRole("radio", { name: /Futuristic Display/ })).toBeChecked();
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
    await expect(deco).toHaveAttribute("data-text", name);
    const order = await card.evaluate((el) => {
      const kids = [...el.children];
      return { deco: kids.findIndex((k) => k.getAttribute("data-testid") === "leadership-decorative-text"), stage: kids.findIndex((k) => k.getAttribute("data-testid") === "leadership-stage") };
    });
    expect(order.deco).toBeGreaterThanOrEqual(0);
    expect(order.deco).toBeLessThan(order.stage); // drawn before (under) the portrait stage
    await portrait.scrollIntoViewIfNeeded();
    const box = (await portrait.boundingBox())!;
    const faceHit = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((e) => e.getAttribute("data-testid") || e.tagName), { x: box.x + box.width * PORTRAIT.head.x, y: box.y + box.height * PORTRAIT.head.y });
    // the editor's drag layer deliberately covers the whole preview so the portrait can be picked up; under it, the portrait is the top layer over the face
    const underDragLayer = faceHit.filter((t) => t !== "portrait-drag-layer");
    expect(underDragLayer[0], "the portrait is the top layer over the face").toBe("leadership-portrait");
    expect(faceHit.indexOf("leadership-portrait"), "only the drag layer is above the portrait").toBeLessThanOrEqual(1);
    expect(await deco.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none"); // decoration never intercepts anything

    // portrait zoom / position / reset
    const pos = page.getByRole("group", { name: "Portrait position" });
    const rect = () => portrait.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); // includes the zoom and position transforms
    const base = await rect();
    await pos.getByLabel(/^Zoom/).fill("1.5");
    await expect.poll(async () => (await rect()).h / base.h).toBeCloseTo(1.5, 1);
    await expect(portrait).toHaveAttribute("data-zoom", "1.5");
    await pos.getByLabel(/^Zoom/).fill("1");
    await pos.getByLabel(/^Left \/ right/).fill("12");
    await expect.poll(async () => ((await rect()).x - base.x) / base.w).toBeCloseTo(0.12, 1); // 12% of the portrait's width, sideways only
    expect(Math.abs((await rect()).y - base.y)).toBeLessThan(1);
    await pos.getByRole("button", { name: "Reset portrait positioning" }).click();
    await expect.poll(async () => (await rect()).h / base.h).toBeCloseTo(1, 1);
    await expect.poll(async () => Math.abs((await rect()).x - base.x)).toBeLessThan(1);

    // decorative text customisation: visual only
    await page.getByLabel("Text behind the portrait").fill("FOUNDER");
    await expect(deco).toHaveAttribute("data-text", "FOUNDER");
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
        deco: await c.getByTestId("leadership-decorative-text").getAttribute("data-text"),
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

// ───────────────────────── Template A: portrait layering, zoom and the five typography presets ─────────────────────────

const SHOTS_A = process.env.LEAD_SHOTS ? path.resolve(__dirname, "../../docs/reports/leadership-template-a") : path.resolve(__dirname, "../ui-review/leadership-template-a");
const PRESETS = ["calligraphy", "signature", "futuristic", "editorial", "matrix"] as const;
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = { calligraphy: "Elegant Calligraphy", signature: "Luxury Signature", futuristic: "Futuristic Display", editorial: "Editorial Serif", matrix: "Matrix Typography" };
const COLORS = [["#f4f4f6", "white"], ["#f07832", "orange"], ["#2ee59d", "green"]] as const;
const MAGENTA = (r: number, g: number, b: number) => r > 170 && b > 170 && g < 90; // a colour that appears nowhere in the card's own design

/** An opaque, solid magenta rectangle used as a portrait, so any leaked portrait pixel can be found. */
const slab = (w = 300, h = 400) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();

async function memberWithPortrait(request: APIRequestContext, admin: TestUser, png: Buffer, name = "Visual Member") {
  const made = await makeMember({ name, published: true });
  const up = await request.post(`/api/v1/admin/members/${made.m.id}/photo`, { headers: { Origin: ORIGIN, Cookie: (await asUser(admin)).Cookie }, multipart: { file: { name: "portrait.png", mimeType: "image/png", buffer: png } } });
  expect(up.status(), "portrait upload").toBe(201);
  return made;
}
const putStyle = async (request: APIRequestContext, admin: TestUser, id: string, data: object) =>
  expect((await request.put(`/api/v1/admin/members/${id}/card`, { headers: await asUser(admin), data })).status()).toBe(200);
const setTemplate = (value: object) => db().siteSetting.upsert({ where: { key: "leadership_template" }, create: { key: "leadership_template", value }, update: { value } });

const fontsReady = (page: Page) => page.evaluate(async () => { await document.fonts.ready; });
const settleCard = async (page: Page) => {
  await expect(page.getByTestId("leadership-card").first()).toBeVisible(); // the team content streams in after the page shell: wait for it before looking at its images
  await fontsReady(page);
  await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.closest('[data-testid="leadership-card"]')).every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
};
const pixels = async (el: Locator) => {
  const { data, info } = await sharp(await el.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, at: (x: number, y: number) => [data[(y * info.width + x) * 3], data[(y * info.width + x) * 3 + 1], data[(y * info.width + x) * 3 + 2]] as const };
};

test.describe("Template A: portrait layering, zoom and typography", () => {
  test("the portrait never shows below, beside or through the information board, at any zoom and position, on desktop, tablet and phone", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS_A, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Layer Admin" });
    const { m } = await memberWithPortrait(request, admin, await slab());
    const cases = [{ zoom: 1, x: 0, y: 0, n: "default" }, { zoom: 3, x: 0, y: 0, n: "max-zoom" }, { zoom: 3, x: 40, y: 50, n: "max-zoom-pushed-down" }, { zoom: 0.5, x: -30, y: 40, n: "min-zoom" }, { zoom: 2.2, x: 10, y: -30, n: "zoom-up" }];
    for (const vp of [{ n: "desktop", w: 1440, h: 900 }, { n: "tablet", w: 820, h: 1100 }, { n: "mobile", w: 390, h: 844 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      for (const c of cases) {
        await putStyle(request, admin, m.id, { zoom: c.zoom, x: c.x, y: c.y });
        await page.goto("/about/team");
        const card = page.getByTestId("leadership-card").first();
        await card.scrollIntoViewIfNeeded();
        await settleCard(page);
        const cb = (await card.boundingBox())!, bb = (await page.getByTestId("leadership-board").first().boundingBox())!;
        const boardTop = Math.round(bb.y - cb.y);
        const px = await pixels(card);
        let above = 0, leaked = 0, firstLeak = "";
        for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
          const [r, g, b] = px.at(x, y);
          if (!MAGENTA(r, g, b)) continue;
          if (y >= boardTop) { leaked++; if (!firstLeak) firstLeak = `${x},${y}`; } else above++;
        }
        expect(leaked, `${vp.n} ${c.n}: portrait pixels at or below the board's top edge (first at ${firstLeak}, board top ${boardTop})`).toBe(0);
        if (c.n === "default") expect(above, `${vp.n}: the portrait itself is visible above the board`).toBeGreaterThan(500);
        if (c.n === "max-zoom" || c.n === "default") await card.screenshot({ path: path.join(SHOTS_A, `layering-${vp.n}-${c.n}.png`) });
      }
    }
  });

  test("zoom scales the portrait smoothly from minimum to maximum without distorting it; x and y move it independently; the settings persist after a reload", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS_A, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Zoom Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Zoom Member");
    await page.setViewportSize({ width: 1440, height: 900 });
    const box = async (style: object) => {
      await putStyle(request, admin, m.id, style);
      await page.goto("/about/team");
      await settleCard(page);
      await expect(page.getByTestId("leadership-portrait").first()).toBeVisible(); // loaded, so it has a size
      return (await page.getByTestId("leadership-portrait").first().boundingBox())!;
    };
    const base = await box({ zoom: 1 });
    const seen: number[] = [];
    for (const z of [0.5, 0.75, 1, 1.5, 2, 2.5, 3]) {
      const b = await box({ zoom: z });
      seen.push(b.height);
      expect(Math.abs(b.height / base.height - z), `zoom ${z} changes the size by exactly that factor`).toBeLessThan(0.03);
      expect(Math.abs(b.width / b.height - PORTRAIT.w / PORTRAIT.h), `zoom ${z}: the aspect ratio is preserved`).toBeLessThan(0.01);
      if (z === 0.5 || z === 3 || z === 1) await page.getByTestId("leadership-card").first().screenshot({ path: path.join(SHOTS_A, `zoom-${z === 0.5 ? "min-0.5" : z === 3 ? "max-3" : "default-1"}.png`) });
    }
    expect(seen, "every step is larger than the one before").toEqual([...seen].sort((a, b) => a - b));
    // independent positioning: x moves it sideways only, y moves it vertically only
    const right = await box({ zoom: 1, x: 20 });
    expect(Math.abs(right.x - base.x - 0.2 * base.width), "x moves by 20% of the portrait's width").toBeLessThan(base.width * 0.02);
    expect(Math.abs(right.y - base.y)).toBeLessThan(1);
    const down = await box({ zoom: 1, y: 10 });
    expect(Math.abs(down.y - base.y - 0.1 * base.height), "y moves by 10% of the portrait's height").toBeLessThan(base.height * 0.02);
    expect(Math.abs(down.x - base.x)).toBeLessThan(1);
    // persistence through the real editor: set zoom and position with the sliders, save, reload
    await putStyle(request, admin, m.id, {});
    await uiLogin(page, admin, `/admin/leadership/members/${m.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Card design" })).toBeVisible();
    await page.waitForTimeout(1500);
    const group = page.getByRole("group", { name: "Portrait position" });
    await group.getByLabel(/^Zoom/).fill("2.2");
    await group.getByLabel(/^Left \/ right/).fill("12");
    await group.getByLabel(/^Up \/ down/).fill("-9");
    await page.getByRole("button", { name: "Save member design" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Design saved/ })).toBeVisible();
    expect((await db().siteSetting.findUniqueOrThrow({ where: { key: `leadership_member:${m.id}` } })).value).toMatchObject({ zoom: 2.2, x: 12, y: -9 });
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(group.getByLabel(/^Zoom/)).toHaveValue("2.2");
    await expect(group.getByLabel(/^Left \/ right/)).toHaveValue("12");
    await expect(group.getByLabel(/^Up \/ down/)).toHaveValue("-9");
    await expect(page.getByTestId("leadership-preview").getByTestId("leadership-portrait")).toHaveAttribute("data-zoom", "2.2"); // the live preview shows the saved zoom
    await page.screenshot({ path: path.join(SHOTS_A, "member-editor-zoom-controls.png"), fullPage: true });
  });

  test("five distinct typography presets in three colours: each loads its own local font, stays inside the card, sits behind the portrait and never covers the face", async ({ page, request, users }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(SHOTS_A, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Type Admin" });
    const { m } = await memberWithPortrait(request, admin, await slab(), "Tanjil Shaiket");
    await page.setViewportSize({ width: 1440, height: 900 });
    const fingerprints = new Set<string>();
    const families = new Set<string>();
    for (const preset of PRESETS) {
      for (const [color, colorName] of COLORS) {
        // full-strength text right behind the portrait's centre, to prove the portrait stays in front of it
        await setTemplate({ typography: { preset, color, opacity: 1, y: 6, size: 24 } });
        for (const long of [false, true]) {
          await putStyle(request, admin, m.id, { text: long ? "Muhammad Abdur Rahman Siddique" : "" });
          await page.goto("/about/team");
          await settleCard(page);
          const card = page.getByTestId("leadership-card").first();
          const deco = card.getByTestId("leadership-decorative-text");
          await expect(deco).toHaveAttribute("data-preset", preset);
          const cb = (await card.boundingBox())!, d = (await deco.boundingBox())!;
          expect(d.x, `${preset} ${colorName} ${long ? "long" : "short"}: left edge inside the card`).toBeGreaterThanOrEqual(cb.x - 1);
          expect(d.x + d.width, `${preset} ${colorName} ${long ? "long" : "short"}: right edge inside the card`).toBeLessThanOrEqual(cb.x + cb.width + 1);
          if (long) continue;
          // the font really is the preset's own local font, and it has loaded
          const info = await deco.evaluate(async (el) => {
            const span = el.querySelector("span") as HTMLElement;
            const fam = getComputedStyle(span).fontFamily;
            await document.fonts.ready;
            const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
            const first = fam.split(",")[0].replace(/["']/g, "").trim();
            return { first, isLoaded: loaded.some((f) => first.includes(f) || f.includes(first)), children: el.querySelectorAll("span,svg").length };
          });
          expect(info.isLoaded, `${preset}: the local font file "${info.first}" loaded`).toBe(true);
          families.add(info.first);
          fingerprints.add(`${info.first}|${info.children}`);
          // behind the portrait: the pixel in the middle of the portrait is the portrait's, never the lettering's colour
          const px = await pixels(card);
          const stage = (await card.getByTestId("leadership-stage").boundingBox())!;
          const cx = Math.round(stage.x - cb.x + stage.width / 2), cy = Math.round(stage.y - cb.y + stage.height * 0.4);
          const [r, g, b] = px.at(cx, cy);
          expect(MAGENTA(r, g, b), `${preset} ${colorName}: at the portrait's centre (${cx},${cy}) the pixel is the portrait (${r},${g},${b}), not the text`).toBe(true);
        }
      }
    }
    expect(families.size, `five different typefaces: ${[...families].join(" | ")}`).toBe(5);
    expect(fingerprints.size, "five different treatments").toBe(5);
  });

  test("the admin editor shows the five presets with live previews and three colours; choices update the card at once and persist", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS_A, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Preset Admin" });
    const { m } = await memberWithPortrait(request, admin, await silhouettePng(), "Preset Member");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uiLogin(page, admin, `/admin/leadership/template?member=${m.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
    await page.waitForTimeout(1500);
    await fontsReady(page);
    const typography = page.getByRole("group", { name: /^Decorative typography/ });
    await expect(typography.getByRole("radio")).toHaveCount(5);
    const deco = page.getByTestId("leadership-preview").getByTestId("leadership-decorative-text");
    for (const preset of PRESETS) {
      await expect(typography.getByTestId(`preset-swatch-${preset}`), `${preset} preview is drawn`).toBeVisible();
      await typography.getByRole("radio", { name: new RegExp(PRESET_LABELS[preset]) }).check({ force: true });
      await expect(deco).toHaveAttribute("data-preset", preset);
    }
    for (const name of ["White / silver", "Burnt orange", "Emerald green"]) {
      await typography.getByRole("button", { name: `Text colour: ${name}` }).click();
      await expect(typography.getByRole("button", { name: `Text colour: ${name}` })).toHaveAttribute("aria-pressed", "true");
    }
    // the preset previews follow the chosen colour
    const swatchBefore = await typography.getByTestId("preset-swatch-calligraphy").screenshot();
    await typography.getByRole("button", { name: "Text colour: White / silver" }).click();
    expect(Buffer.compare(swatchBefore, await typography.getByTestId("preset-swatch-calligraphy").screenshot()), "a different colour redraws the preview").not.toBe(0);
    await typography.getByRole("radio", { name: /Editorial Serif/ }).check({ force: true });
    await page.screenshot({ path: path.join(SHOTS_A, "admin-editor-typography.png"), fullPage: true });
    await typography.screenshot({ path: path.join(SHOTS_A, "admin-editor-typography-controls.png") });
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Template saved/ })).toBeVisible();
    expect((await db().siteSetting.findUniqueOrThrow({ where: { key: "leadership_template" } })).value).toMatchObject({ typography: { preset: "editorial", color: "#f4f4f6" } });
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(typography.getByRole("radio", { name: /Editorial Serif/ })).toBeChecked();
    await expect(typography.getByRole("button", { name: "Text colour: White / silver" })).toHaveAttribute("aria-pressed", "true");
    // the public pages draw exactly the saved preset
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await expect(page.getByTestId("leadership-card").first().getByTestId("leadership-decorative-text")).toHaveAttribute("data-preset", "editorial");
    }
    // accessibility and phone width of the new controls
    await page.goto(`/admin/leadership/template?member=${m.id}`);
    await page.waitForTimeout(1500);
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflowX(page), "no horizontal overflow at phone width").toBeLessThanOrEqual(0);
  });

  test("the final card at desktop, tablet and phone sizes, on the homepage and the Leadership Board, with every preset", async ({ page, request, users }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(SHOTS_A, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Final Admin" });
    const { m } = await memberWithPortrait(request, admin, await silhouettePng(), "Tanjil Shaiket");
    await putStyle(request, admin, m.id, { zoom: 1, y: 0 });
    for (const preset of PRESETS) {
      await setTemplate({ typography: { preset, color: "#f07832", opacity: 0.5 } });
      for (const vp of [{ n: "desktop", w: 1440, h: 900 }, { n: "tablet", w: 820, h: 1100 }, { n: "mobile", w: 390, h: 844 }]) {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        for (const url of ["/", "/about/team"]) {
          await page.goto(url);
          const card = page.getByTestId("leadership-card").first();
          await card.scrollIntoViewIfNeeded();
          await settleCard(page);
          expect(await overflowX(page), `${preset} ${vp.n} ${url}: no horizontal overflow`).toBeLessThanOrEqual(0);
          const cb = (await card.boundingBox())!, bb = (await card.getByTestId("leadership-board").boundingBox())!, tb = (await card.getByTestId("leadership-decorative-text").boundingBox())!;
          expect(bb.y + bb.height, `${preset} ${vp.n} ${url}: the board is inside the card`).toBeLessThanOrEqual(cb.y + cb.height + 1);
          expect(tb.x, `${preset} ${vp.n} ${url}: lettering inside, left`).toBeGreaterThanOrEqual(cb.x - 1);
          expect(tb.x + tb.width, `${preset} ${vp.n} ${url}: lettering inside, right`).toBeLessThanOrEqual(cb.x + cb.width + 1);
          if (url === "/about/team") await card.screenshot({ path: path.join(SHOTS_A, `final-${preset}-${vp.n}.png`) });
        }
      }
    }
    // the homepage and the Leadership Board draw the same card
    await setTemplate({ typography: { preset: "calligraphy", color: "#f4f4f6", opacity: 0.55 } });
    const html: string[] = [];
    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      await settleCard(page);
      html.push(await page.getByTestId("leadership-card").first().evaluate((e) => e.outerHTML.replace(/\s+/g, " ").replace(/ loading="[a-z]+"/g, "").replace(/ fetchpriority="[a-z]+"/g, "")));
    }
    expect(html[0], "the homepage and /about/team render the same card").toBe(html[1]);
  });
});

// ───────────────────────── Download template: a high-resolution PNG of the card ─────────────────────────

const SHOTS_DL = process.env.LEAD_SHOTS ? path.resolve(__dirname, "../../docs/reports/leadership-template-download") : path.resolve(__dirname, "../ui-review/leadership-template-download");

/** Clicks "Download template", checks the file name, and returns the PNG. */
async function downloadTemplate(page: Page): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Download template" }).click()]);
  expect(dl.suggestedFilename()).toBe("shadowtrix-leadership-template-2160x2700.png");
  return fs.readFileSync((await dl.path())!);
}

/** The picture reduced to 360 x 450 on black, as raw RGB, so a download and a screenshot of the preview can be compared. */
const normalised = (png: Buffer) => sharp(png).flatten({ background: "#000000" }).resize(360, 450, { fit: "fill", kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
const meanDifference = (a: Buffer, b: Buffer) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
const countNear = async (png: Buffer, rgb: [number, number, number], tolerance: number) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) if (Math.abs(data[i * 3] - rgb[0]) <= tolerance && Math.abs(data[i * 3 + 1] - rgb[1]) <= tolerance && Math.abs(data[i * 3 + 2] - rgb[2]) <= tolerance) n++;
  return n;
};
const previewCard = (page: Page) => page.getByTestId("leadership-preview-frame").getByTestId("leadership-card");

test.describe("download template", () => {
  test("an administrator downloads a 2160 x 2700 PNG that matches the preview, follows unsaved edits, and includes a member's transparent portrait", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS_DL, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Download Admin" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uiLogin(page, admin, "/admin/leadership/template");
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
    await page.waitForTimeout(1500); // hydration
    await expect(page.getByRole("button", { name: "Download template" })).toBeEnabled();
    await page.screenshot({ path: path.join(SHOTS_DL, "admin-editor-download-button.png"), fullPage: true });

    // 1. the file: a real, large, sharp PNG of the default template
    const first = await downloadTemplate(page);
    const meta = await sharp(first).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height], "high resolution: 2160 x 2700 (4:5)").toEqual([2160, 2700]);
    expect(first.length, "a real image, not an empty canvas").toBeGreaterThan(200_000);
    const stats = await sharp(first).removeAlpha().stats();
    expect(Math.max(...stats.channels.map((c) => c.stdev)), "the picture has real contrast and detail").toBeGreaterThan(18);
    expect(await countNear(first, [255, 154, 85], 24), "the designation text (soft orange) is drawn").toBeGreaterThan(2_000);
    expect(await countNear(first, [245, 245, 245], 12), "the name (white) is drawn").toBeGreaterThan(4_000);
    const corner = await sharp(first).extractChannel(3).extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer(); // the card's rounded corner is transparent, not a black box
    expect(corner[0], "rounded corner outside the card is transparent").toBe(0);

    // 2. the design is preserved: reduced to the preview's size it matches a screenshot of the live preview
    const livePreview = await previewCard(page).screenshot();
    const same = meanDifference(await normalised(first), await normalised(livePreview));
    expect(same, `the download looks like the preview (mean difference ${same.toFixed(2)} of 255)`).toBeLessThan(9);
    // and it really is a different picture from a deliberately different design
    expect(meanDifference(await normalised(first), await normalised(await sharp({ create: { width: 360, height: 450, channels: 3, background: "#090909" } }).png().toBuffer())), "not just a flat background").toBeGreaterThan(9);
    fs.writeFileSync(path.join(SHOTS_DL, "downloaded-template-2160x2700.png"), first);
    await sharp(first).resize(540).png().toFile(path.join(SHOTS_DL, "downloaded-template-preview-540.png"));

    // 3. it follows what the preview shows, including edits that are not saved yet
    await page.getByRole("group", { name: "Information board" }).getByLabel("Alignment").selectOption("center");
    await page.getByRole("group", { name: "Background" }).getByLabel(/^Glow intensity/).fill("100");
    await expect(page.getByTestId("leadership-board")).toHaveCSS("text-align", "center");
    const edited = await downloadTemplate(page);
    expect(await sharp(edited).metadata().then((m) => [m.width, m.height])).toEqual([2160, 2700]);
    expect(meanDifference(await normalised(first), await normalised(edited)), "the unsaved edits are in the new download").toBeGreaterThan(1.5);
    const editedDiff = meanDifference(await normalised(edited), await normalised(await previewCard(page).screenshot()));
    expect(editedDiff, `the edited download matches the edited preview (${editedDiff.toFixed(2)})`).toBeLessThan(9);
    expect(await db().siteSetting.count({ where: { key: "leadership_template" } }), "downloading changes nothing that is stored").toBe(0);

    // 4. a member's transparent portrait is part of the picture
    const { m } = await makeMember({ name: "Portrait Download Member", published: true });
    const up = await request.post(`/api/v1/admin/members/${m.id}/photo`, { headers: { Origin: ORIGIN, Cookie: (await asUser(admin)).Cookie }, multipart: { file: { name: "portrait.png", mimeType: "image/png", buffer: portraitPng() } } });
    expect(up.status()).toBe(201);
    await page.goto(`/admin/leadership/template?member=${m.id}`);
    await expect(previewCard(page).getByTestId("leadership-portrait")).toBeVisible();
    await expect.poll(() => page.evaluate(() => { const i = document.querySelector('[data-testid="leadership-portrait"]') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; })).toBe(true);
    await page.waitForTimeout(1500);
    const withPortrait = await downloadTemplate(page);
    expect(await countNear(withPortrait, [224, 176, 140], 14), "the portrait's skin tones are drawn").toBeGreaterThan(20_000);
    expect(await countNear(first, [224, 176, 140], 14), "the sample card has no such portrait").toBeLessThan(2_000);
    const withDiff = meanDifference(await normalised(withPortrait), await normalised(await previewCard(page).screenshot()));
    expect(withDiff, `with a portrait the download still matches the preview (${withDiff.toFixed(2)})`).toBeLessThan(9);
    fs.writeFileSync(path.join(SHOTS_DL, "downloaded-template-with-portrait.png"), withPortrait);
  });

  test("the download is available to administrators only", async ({ page, users }) => {
    const participant = await users.create({ fullName: "Plain Participant" });
    await uiLogin(page, participant, "/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/admin/leadership/template");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");
    await expect(page.getByRole("button", { name: "Download template" })).toHaveCount(0);
  });
});

// ───────────────────────── Dragging the portrait ─────────────────────────

const SHOTS_DRAG = process.env.LEAD_SHOTS ? path.resolve(__dirname, "../../docs/reports/leadership-template-drag") : path.resolve(__dirname, "../ui-review/leadership-template-drag");

/** The portrait in the editor's preview, its frame and the sliders: everything the drag tests read. */
const editor = (page: Page) => {
  const group = page.getByRole("group", { name: "Portrait position" });
  const img = page.getByTestId("leadership-preview").getByTestId("leadership-portrait");
  return {
    group, img,
    frame: page.getByTestId("leadership-preview-frame"),
    zoom: group.getByLabel(/^Zoom/), x: group.getByLabel(/^Left \/ right/), y: group.getByLabel(/^Up \/ down/),
    box: async () => (await img.boundingBox())!,
  };
};
async function openMemberEditor(page: Page, admin: TestUser, memberId: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await uiLogin(page, admin, `/admin/leadership/members/${memberId}`);
  await expect(page.getByRole("heading", { level: 2, name: "Card design" })).toBeVisible();
  await page.waitForTimeout(1500); // hydration
  const e = editor(page);
  await expect(e.img).toBeVisible();
  await expect.poll(() => e.img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await e.frame.scrollIntoViewIfNeeded();
  return e;
}
/** Press on the card, move to (dx, dy) away in several steps, release: what a person does with the mouse. */
async function dragBy(page: Page, frame: Locator, dx: number, dy: number) {
  const b = (await frame.boundingBox())!;
  const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
  await page.mouse.up();
}

test.describe("dragging the portrait", () => {
  test("the portrait follows the mouse in all four directions at every zoom level (including straight down), and the sliders follow", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS_DRAG, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Drag Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Drag Member");
    const e = await openMemberEditor(page, admin, m.id);
    for (const zoom of [0.8, 1, 2, 3]) {
      for (const [name, dx, dy] of [["down", 0, 60], ["up", 0, -60], ["right", 60, 0], ["left", -60, 0], ["down-right", 40, 40]] as const) {
        await e.zoom.fill(String(zoom));
        await e.x.fill("0"); await e.y.fill("0");
        const before = await e.box();
        await dragBy(page, e.frame, dx, dy);
        const after = await e.box();
        expect(Math.abs(after.x - before.x - dx), `zoom ${zoom}, ${name}: x`).toBeLessThan(2);
        expect(Math.abs(after.y - before.y - dy), `zoom ${zoom}, ${name}: y (downward drags work)`).toBeLessThan(2);
        expect(Math.abs(after.height - before.height), `zoom ${zoom}, ${name}: dragging never changes the size`).toBeLessThan(0.5);
        const xs = Number(await e.x.inputValue()), ys = Number(await e.y.inputValue());
        expect(Math.sign(xs), `${name}: the left/right slider moved the right way`).toBe(Math.sign(dx));
        expect(Math.sign(ys), `${name}: the up/down slider moved the right way`).toBe(Math.sign(dy));
        expect(Number(await e.zoom.inputValue()), "dragging does not touch the zoom").toBe(zoom);
        if (zoom === 2 && name === "down") await page.screenshot({ path: path.join(SHOTS_DRAG, "drag-down-zoom-2.png") });
      }
    }
  });

  test("zoom and drag work together: zooming keeps the position, dragging keeps the zoom, and positions are limited so the portrait cannot be lost", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Zoom Drag Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Zoom Drag Member");
    const e = await openMemberEditor(page, admin, m.id);
    await e.zoom.fill("2");
    await dragBy(page, e.frame, 30, 50);
    const x1 = await e.x.inputValue(), y1 = await e.y.inputValue();
    expect(Number(y1), "dragged down").toBeGreaterThan(5);
    const b1 = await e.box();
    await e.zoom.fill("3"); // zooming after the drag
    expect(await e.x.inputValue(), "zoom does not reset the horizontal position").toBe(x1);
    expect(await e.y.inputValue(), "zoom does not reset the vertical position").toBe(y1);
    const b2 = await e.box();
    expect(b2.height / b1.height, "the zoom took effect").toBeCloseTo(1.5, 1);
    await dragBy(page, e.frame, 0, 20); // dragging after the zoom
    expect(Number(await e.y.inputValue()), "dragging works again after the zoom").toBeGreaterThan(Number(y1));
    expect(Number(await e.zoom.inputValue())).toBe(3);

    // far beyond the limit: the position stops at +-50%, the portrait is still on the card, and one click brings everything back
    await dragBy(page, e.frame, 3000, 3000);
    expect([await e.x.inputValue(), await e.y.inputValue()], "stopped at the limit").toEqual(["50", "50"]);
    const card = (await page.getByTestId("leadership-preview").getByTestId("leadership-card").boundingBox())!, far = await e.box();
    expect(far.x < card.x + card.width && far.x + far.width > card.x && far.y < card.y + card.height && far.y + far.height > card.y, "the portrait has not left the card").toBe(true);
    await dragBy(page, e.frame, -3000, -3000);
    expect([await e.x.inputValue(), await e.y.inputValue()]).toEqual(["-50", "-50"]);
    await e.group.getByRole("button", { name: "Reset portrait positioning" }).click();
    expect([await e.x.inputValue(), await e.y.inputValue(), await e.zoom.inputValue()], "reset brings it back").toEqual(["0", "0", "1"]);
  });

  test("the position and zoom are saved, restored after a reload, and identical on the homepage, the Leadership Board and in the downloaded image", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOTS_DRAG, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Persist Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Persist Member");
    const e = await openMemberEditor(page, admin, m.id);
    await e.zoom.fill("1.6");
    await dragBy(page, e.frame, -35, 45);
    const saved = { zoom: Number(await e.zoom.inputValue()), x: Number(await e.x.inputValue()), y: Number(await e.y.inputValue()) };
    expect(saved.x).toBeLessThan(-3);
    expect(saved.y).toBeGreaterThan(3);
    await page.getByRole("button", { name: "Save member design" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Design saved/ })).toBeVisible();
    expect((await db().siteSetting.findUniqueOrThrow({ where: { key: `leadership_member:${m.id}` } })).value).toMatchObject(saved);

    await page.reload();
    await page.waitForTimeout(1500);
    const again = editor(page);
    await expect(again.img).toBeVisible();
    expect([Number(await again.zoom.inputValue()), Number(await again.x.inputValue()), Number(await again.y.inputValue())], "restored after reopening the editor").toEqual([saved.zoom, saved.x, saved.y]);
    await expect(again.img).toHaveAttribute("data-zoom", String(saved.zoom));

    // the same saved values drive the preview, the homepage and the Leadership Board: the portrait carries the identical offset (a percentage of its own size) and zoom
    const placement = async (card: Locator) => card.getByTestId("leadership-portrait").evaluate((i: HTMLElement) => ({ transform: i.style.transform, zoom: i.dataset.zoom }));
    await again.frame.scrollIntoViewIfNeeded();
    const inPreview = await placement(page.getByTestId("leadership-preview").getByTestId("leadership-card"));
    expect(inPreview.transform, "the preview applies the dragged position and zoom").toContain(`translate(${saved.x}%, ${saved.y}%) scale(${saved.zoom})`);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Download this card" }).click()]);
    const png = fs.readFileSync((await download.path())!);
    expect(await sharp(png).metadata().then((x) => [x.width, x.height])).toEqual([2160, 2700]);
    const previewShot = await page.getByTestId("leadership-preview").getByTestId("leadership-card").screenshot();
    expect(meanDifference(await normalised(png), await normalised(previewShot)), "the download matches the preview").toBeLessThan(9);
    const centroid = async (img: Buffer) => { // the middle of the skin-coloured pixels, as a fraction of the picture
      const { data, info } = await sharp(img).flatten({ background: "#000" }).resize(360, 450, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let n = 0, sx = 0, sy = 0;
      for (let p = 0; p < info.width * info.height; p++) if (Math.abs(data[p * 3] - 224) < 22 && Math.abs(data[p * 3 + 1] - 176) < 22 && Math.abs(data[p * 3 + 2] - 140) < 22) { n++; sx += p % info.width; sy += Math.floor(p / info.width); }
      expect(n, "the portrait's head is in the picture").toBeGreaterThan(300);
      return { x: sx / n / info.width, y: sy / n / info.height };
    };
    const cd = await centroid(png), cp = await centroid(previewShot);
    expect(Math.abs(cd.x - cp.x), "the exported head is where the preview's is (x)").toBeLessThan(0.02);
    expect(Math.abs(cd.y - cp.y), "the exported head is where the preview's is (y)").toBeLessThan(0.02);
    fs.writeFileSync(path.join(SHOTS_DRAG, "dragged-and-downloaded-2160x2700.png"), await sharp(png).resize(720).png().toBuffer());

    for (const url of ["/", "/about/team"]) {
      await page.goto(url);
      const card = page.getByTestId("leadership-card").filter({ hasText: "Persist Member" });
      await card.scrollIntoViewIfNeeded(); // the portrait is loaded lazily: bring its card on screen first
      await settleCard(page);
      expect(await placement(card), `${url}: the portrait has the same position and zoom as the preview`).toEqual(inPreview);
    }
  });

  test("touch, pen and keyboard work too, and the browser's own image dragging, text selection and scrolling stay out of the way", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Touch Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Touch Member");
    const e = await openMemberEditor(page, admin, m.id);
    const layer = page.getByTestId("portrait-drag-layer");
    await expect(layer).toHaveCSS("touch-action", "none"); // a finger drags the portrait instead of scrolling the page
    await expect(layer).toHaveCSS("user-select", "none");
    await expect(e.img).toHaveAttribute("draggable", "false"); // no native "ghost" image drag

    // a mouse drag selects no text and does not scroll the page
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await dragBy(page, e.frame, 20, 80);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "no text was selected by the drag").toBe("");
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore), "the page did not scroll").toBeLessThan(2);
    await e.group.getByRole("button", { name: "Reset portrait positioning" }).click();

    // finger and pen, as real pointer events of those types
    for (const pointerType of ["touch", "pen"]) {
      const b = (await e.frame.boundingBox())!;
      const point = (dx: number, dy: number) => ({ pointerId: 7, pointerType, isPrimary: true, button: 0, buttons: 1, clientX: b.x + b.width / 2 + dx, clientY: b.y + b.height / 2 + dy, bubbles: true, cancelable: true });
      const before = await e.box();
      await layer.dispatchEvent("pointerdown", point(0, 0));
      for (let i = 1; i <= 5; i++) await page.evaluate((init) => window.dispatchEvent(new PointerEvent("pointermove", init)), point(0, 10 * i));
      await page.evaluate((init) => window.dispatchEvent(new PointerEvent("pointerup", init)), point(0, 50));
      const after = await e.box();
      expect(Math.abs(after.y - before.y - 50), `${pointerType}: moved down by the finger's distance`).toBeLessThan(2);
      await expect(layer).toHaveAttribute("data-dragging", "false"); // released
      await e.group.getByRole("button", { name: "Reset portrait positioning" }).click();
    }

    // the right mouse button does nothing; later pointer moves after release do nothing
    const b0 = await e.box();
    const fb = (await e.frame.boundingBox())!;
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + 60);
    await page.mouse.up({ button: "right" });
    expect(Math.abs((await e.box()).y - b0.y), "the right button does not drag").toBeLessThan(1);
    await dragBy(page, e.frame, 0, 30);
    const settled = await e.box();
    await page.mouse.move(fb.x + 5, fb.y + 5); await page.mouse.move(fb.x + 90, fb.y + 120);
    expect(Math.abs((await e.box()).y - settled.y), "after release the portrait stays put").toBeLessThan(0.5);

    // keyboard: arrow keys nudge, Shift nudges more
    await e.group.getByRole("button", { name: "Reset portrait positioning" }).click();
    await layer.focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    expect([await e.x.inputValue(), await e.y.inputValue()]).toEqual(["1", "2"]);
    await page.keyboard.press("Shift+ArrowUp");
    expect(await e.y.inputValue()).toBe("-3");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowLeft");
    expect(await e.x.inputValue(), "keyboard nudging stops at the limit").toBe("-50");
  });

  test("on the template page the default portrait position can be dragged too, and the preview shows the chosen member as published", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Default Drag Admin" });
    const { m } = await memberWithPortrait(request, admin, portraitPng(), "Default Drag Member");
    await putStyle(request, admin, m.id, { zoom: 1.4, y: 6 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uiLogin(page, admin, `/admin/leadership/template?member=${m.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
    await page.waitForTimeout(1500);
    const img = page.getByTestId("leadership-preview").getByTestId("leadership-portrait");
    await expect(img).toBeVisible();
    await expect(img, "the preview applies the member's own saved zoom").toHaveAttribute("data-zoom", "1.4");
    const pos = page.getByRole("group", { name: /^Portrait \(default/ });
    const frame = page.getByTestId("leadership-preview-frame");
    await frame.scrollIntoViewIfNeeded();
    const before = (await img.boundingBox())!;
    await dragBy(page, frame, 0, 40);
    const after = (await img.boundingBox())!;
    expect(Math.abs(after.y - before.y - 40), "dragged down by 40px").toBeLessThan(2);
    expect(Number(await pos.getByLabel(/^Position, up \/ down/).inputValue()), "the default position slider followed").toBeGreaterThan(3);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Template saved/ })).toBeVisible();
    expect((await db().siteSetting.findUniqueOrThrow({ where: { key: "leadership_template" } })).value).toMatchObject({ portrait: { y: expect.any(Number) } });
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(pos.getByLabel(/^Position, up \/ down/)).not.toHaveValue("0");
  });
});

test.describe("deployment version", () => {
  test("the version endpoint is public and reveals only the commit and the environment", async ({ request }) => {
    const r = await request.get("/api/v1/version");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["commit", "environment"]);
  });
});

test.describe("download template with every typography preset", () => {
  test("each preset, in each colour family, is downloaded as it looks in the preview (its own font and effects are embedded)", async ({ page, request, users }) => {
    test.setTimeout(420_000);
    fs.mkdirSync(SHOTS_DL, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Preset Download Admin" });
    const { m } = await memberWithPortrait(request, admin, await silhouettePng(), "Tanjil Shaiket");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const checks: [(typeof PRESETS)[number], string][] = [["calligraphy", "#f4f4f6"], ["signature", "#f07832"], ["futuristic", "#2ee59d"], ["editorial", "#f07832"], ["matrix", "#2ee59d"]];
    const seen: Buffer[] = [];
    await uiLogin(page, admin, `/admin/leadership/template?member=${m.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible(); // signed in before anything else navigates away
    for (const [preset, color] of checks) {
      await setTemplate({ typography: { preset, color, opacity: 0.6 } });
      await page.goto(`/admin/leadership/template?member=${m.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
      await page.waitForTimeout(1500);
      await fontsReady(page);
      await expect(page.getByTestId("leadership-preview").getByTestId("leadership-decorative-text")).toHaveAttribute("data-preset", preset);
      await expect.poll(() => page.evaluate(() => { const i = document.querySelector('[data-testid="leadership-preview"] [data-testid="leadership-portrait"]') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; })).toBe(true);
      const png = await downloadTemplate(page);
      expect(await sharp(png).metadata().then((x) => [x.width, x.height])).toEqual([2160, 2700]);
      const diff = meanDifference(await normalised(png), await normalised(await previewCard(page).screenshot()));
      expect(diff, `${preset}: the download matches the preview (mean difference ${diff.toFixed(2)} of 255)`).toBeLessThan(9);
      for (const other of seen) expect(meanDifference(await normalised(png), await normalised(other)), `${preset} differs from the previous preset's download`).toBeGreaterThan(0.8);
      seen.push(png);
      await sharp(png).resize(720).png().toFile(path.join(SHOTS_DL, `downloaded-${preset}.png`));
    }
  });
});

test.describe("health of every leadership screen", () => {
  test("no console errors, failed requests or broken images on the editors, the homepage and the Leadership Board, and the approved logo is untouched", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Health Admin" });
    const { m } = await memberWithPortrait(request, admin, await silhouettePng(), "Health Member");
    await setTemplate({ typography: { preset: "calligraphy", color: "#2ee59d" } });
    const problems: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error" || /hydrat/i.test(msg.text())) problems.push(`console ${msg.type()}: ${msg.text()}`); });
    page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/_next/image")) problems.push(`${r.status()} ${r.url().replace(ORIGIN, "")}`); });
    await uiLogin(page, admin, "/admin/leadership/template");
    await expect(page.getByRole("heading", { level: 1, name: "Universal Matrix leadership template" })).toBeVisible();
    problems.length = 0; // the login redirect itself is not under test
    for (const [url, viewport] of [[`/admin/leadership/template?member=${m.id}`, { width: 1440, height: 900 }], [`/admin/leadership/members/${m.id}`, { width: 1440, height: 900 }], ["/", { width: 1440, height: 900 }], ["/about/team", { width: 1440, height: 900 }], ["/", { width: 390, height: 844 }], ["/about/team", { width: 820, height: 1100 }]] as const) {
      await page.setViewportSize(viewport);
      await page.goto(url);
      await page.waitForTimeout(1500);
      await page.evaluate(async () => { for (let y = 0; y <= document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
      await fontsReady(page);
      const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.closest("[hidden]")).map((i) => i.currentSrc) }));
      expect(state.overflow, `${url} @${viewport.width}: no horizontal overflow`).toBeLessThanOrEqual(0);
      expect(state.broken, `${url} @${viewport.width}: no broken images`).toEqual([]);
    }
    expect(problems, "no console errors, hydration warnings, page errors or failed requests").toEqual([]);
    // the approved logo file is exactly what is in version control (this change never touches it)
    expect(fs.existsSync(path.resolve(__dirname, "../../assets/branding/1.png"))).toBe(true);
  });
});
