import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { COOKIE, createRawSession, db, expect, test, uiLogin } from "./helpers/fixtures";

const OUT = path.resolve(__dirname, "../ui-review/banner");
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = () => randomUUID().slice(0, 6);

/** A synthetic 3000 x 2000 "photo" made in the page, so the test needs no image file and exercises the downscale path. */
async function fakePhoto(page: Page) {
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

async function member(userId: string | undefined, opts: { placeholder?: boolean; position?: string } = {}) {
  const t = tag();
  const unit = await db().orgUnit.create({ data: { slug: `e2e-bn-${t}`, name: `E2E Unit ${t}` } });
  const m = await db().orgMember.create({ data: { slug: `e2e-bn-${t}`, fullName: `E2E Banner ${t}`, isPlaceholder: opts.placeholder ?? false, userId } });
  let designation: { id: string; title: string } | null = null;
  if (opts.position) {
    designation = await db().designation.create({ data: { title: `${opts.position} ${t}`, rankOrder: 1 } });
    await db().orgMembership.create({ data: { memberId: m.id, unitId: unit.id, designationId: designation.id } });
  }
  return { m, unit, designation };
}

async function cleanup(items: { m: { id: string }; unit: { id: string }; designation: { id: string } | null }[]) {
  for (const i of items) {
    await db().orgMember.deleteMany({ where: { id: i.m.id } });
    await db().orgUnit.deleteMany({ where: { id: i.unit.id } });
    if (i.designation) await db().designation.deleteMany({ where: { id: i.designation.id } });
  }
}

function pngSize(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test.describe("official banner creator", () => {
  test("requires sign-in; admin picker is for administrators only", async ({ page, users, request }) => {
    await page.goto("/dashboard/banner");
    await expect(page).toHaveURL(/\/login/);
    const plain = await users.create({ fullName: "Plain Person" });
    await uiLogin(page, plain, "/admin/leadership/banner");
    await expect(page.getByRole("heading", { name: "Member banner" })).toHaveCount(0);
    void request;
  });

  test("an ordinary member gets no designation choices; the portrait can be positioned and exported at exactly 1080 x 1350, identical to the preview", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const plain = await users.create({ fullName: "Priya Participant" });
    await uiLogin(page, plain, "/dashboard/banner");
    await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Priya Participant");
    const select = page.getByLabel(/^Designation/);
    await expect(select).toBeDisabled();
    await expect(select.locator("option")).toHaveCount(1);
    await expect(page.getByText(/does not give anyone any access/)).toBeVisible();

    // wrong file types and oversized names are refused/limited
    await page.locator('input[type="file"]').setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert").filter({ hasText: /JPEG, PNG or WebP/ })).toBeVisible();
    expect(await page.getByLabel(/^Name/).getAttribute("maxlength")).toBe("60");

    await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await fakePhoto(page) });
    await expect(page.getByText("Drag the preview to reposition the portrait.")).toBeVisible();
    await page.getByLabel("Zoom").fill("1.6");
    await page.getByLabel("Left / right").fill("0.4");
    await page.getByLabel("Up / down").fill("-0.3");
    await page.getByLabel(/^Name/).fill("Priyanka Wickramasinghe-Balasubramaniam Longname");
    await page.getByLabel(/^Tagline/).fill("Building things that matter, one commit at a time, together with the whole ShadowTrix community.");
    const canvas = page.getByTestId("banner-canvas");
    await page.waitForTimeout(500);
    fs.mkdirSync(OUT, { recursive: true });
    await canvas.screenshot({ path: path.join(OUT, "plain-long-name.png") });

    const preview = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, data: c.toDataURL("image/png") }));
    expect([preview.w, preview.h]).toEqual([1080, 1350]);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^shadowtrix-banner-[a-z0-9-]+\.png$/);
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    expect(buf.equals(Buffer.from(preview.data.split(",")[1], "base64"))).toBe(true); // preview and export are the same pixels
  });

  test("a verified member can choose only an approved designation; placeholders and others are not offered", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const u = await users.create({ fullName: "Verified Member" });
    const mine = await member(u.id, { position: "President" });
    await uiLogin(page, u, "/dashboard/banner");
    const select = page.getByLabel(/^Designation/);
    await expect(select).toBeEnabled();
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual(["None", mine.designation!.title]);
    await page.getByLabel(/^Tagline/).fill("Team EU Shadow");
    await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await fakePhoto(page) });
    await page.waitForTimeout(500);
    await page.getByTestId("banner-canvas").screenshot({ path: path.join(OUT, "member-designation.png") });
    await cleanup([mine]);
  });

  test("administrator: only verified members are listed; the designation comes from their approved position", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Ada Admin" });
    const real = await member(undefined, { position: "Secretary" });
    const fake = await member(undefined, { placeholder: true, position: "Founder" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().addCookies([{ name: COOKIE, value: await createRawSession(admin.id), url: "http://localhost:3011" }]);
    await page.goto("/admin/leadership/banner");
    await expect(page.getByRole("heading", { name: "Member banner" })).toBeVisible();
    const opts = await page.locator("#bm option").allTextContents();
    expect(opts.some((o) => o.startsWith(real.m.fullName))).toBe(true);
    expect(opts.some((o) => o.startsWith(fake.m.fullName))).toBe(false);
    await page.goto(`/admin/leadership/banner?member=${real.m.id}`);
    await expect(page.getByLabel(/^Name/)).toHaveValue(real.m.fullName);
    expect(await page.getByLabel(/^Designation/).locator("option").allTextContents()).toEqual(["None", real.designation!.title]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "admin-page.png"), fullPage: true });
    // a placeholder id never yields a banner
    await page.goto(`/admin/leadership/banner?member=${fake.m.id}`);
    await expect(page.getByLabel(/^Designation/)).toHaveCount(0);
    await cleanup([real, fake]);
  });

  test("templates are offered only to people whose records support them; each renders differently and exports exactly what the preview shows", async ({ page, users }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const SHOTS = process.env.BANNER_SHOTS ? path.resolve(__dirname, "../../docs/reports/banner-redesign") : OUT;
    fs.mkdirSync(SHOTS, { recursive: true });

    // an ordinary person: participant only, no event choices
    const plain = await users.create({ fullName: "Plain Template Person" });
    await uiLogin(page, plain, "/dashboard/banner");
    await expect(page.getByRole("radio")).toHaveCount(1);
    await expect(page.getByRole("radio", { name: "Participant" })).toBeChecked();
    await expect(page.getByLabel(/^Event/)).toBeDisabled();

    // a person with every record: all six templates, and only their own events
    await page.context().clearCookies();
    const all = await users.create({ roles: ["ORGANIZER", "JUDGE"], fullName: "Amina Rahman Chowdhury" });
    const mine = await member(all.id, { position: "Founder" });
    const second = await db().designation.create({ data: { title: `Co-Founder ${tag()}`, rankOrder: 2 } });
    await db().orgMembership.create({ data: { memberId: mine.m.id, unitId: mine.unit.id, designationId: second.id } });
    const now = Date.now();
    const ev = (title: string, createdById: string) => db().event.create({
      data: { slug: `e2e-bt-${tag()}`, title, category: "HACKATHON", summary: "s", description: "d", createdById, status: "PUBLISHED", startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 2 * 86_400_000), registrationOpensAt: new Date(now - 86_400_000), registrationClosesAt: new Date(now + 43_200_000) },
    });
    const owned = await ev("ShadowTrix International Spring Hackathon 2026 Grand Finals and Awards", all.id);
    const strangers = await ev("E2E Someone Else Event", plain.id);
    await db().eventOrganizer.create({ data: { eventId: owned.id, userId: all.id, isLead: true } });
    try {
      await uiLogin(page, all, "/dashboard/banner");
      await expect(page.getByRole("radio")).toHaveCount(6);
      expect((await page.getByRole("radio").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).sort()).toEqual(["co-founder", "founder", "judge", "organizer", "participant", "team-member"]);
      const events = await page.getByLabel(/^Event/).locator("option").allTextContents();
      expect(events).toEqual(["None", owned.title]);
      expect(events.join()).not.toContain("Someone Else");
      expect(await page.getByLabel(/^Designation/).locator("option").count()).toBe(3); // None + Founder + Co-Founder

      await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await fakePhoto(page) });
      await expect(page.getByText("Drag the preview to reposition the portrait.")).toBeVisible();
      await page.getByLabel(/^Event/).selectOption(owned.id);
      await page.getByLabel(/^Tagline/).fill("Enter the Matrix of Innovation.");
      const canvas = page.getByTestId("banner-canvas");
      const seen = new Set<string>();
      for (const id of ["founder", "co-founder", "organizer", "participant", "team-member", "judge"]) {
        await page.locator(`input[name="banner-template"][value="${id}"]`).check({ force: true });
        await expect(canvas).toHaveAttribute("aria-label", new RegExp(id === "team-member" ? "Team member" : id === "co-founder" ? "Co-Founder" : id, "i"));
        await page.waitForTimeout(450);
        const data = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
        expect(seen.has(data)).toBe(false); // every template looks different
        seen.add(data);
        fs.writeFileSync(path.join(SHOTS, `template-${id}.png`), Buffer.from(data.split(",")[1], "base64")); // the real artwork, not a page screenshot
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
        const buf = fs.readFileSync((await dl.path())!);
        expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
        expect(buf.equals(Buffer.from(data.split(",")[1], "base64"))).toBe(true); // export equals preview
      }
      expect(seen.size).toBe(6);
      await page.setViewportSize({ width: 1440, height: 1500 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, "editor-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, "editor-mobile.png"), fullPage: true });
      void strangers;
    } finally {
      await db().event.deleteMany({ where: { id: { in: [owned.id, strangers.id] } } });
      await cleanup([mine]); // removes the member (and with it the memberships) before the designation they point at
      await db().designation.deleteMany({ where: { id: second.id } });
    }
  });

  test("a missing designation and a very long name, designation-less event or tagline still produce a clean 1080 x 1350 banner", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const u = await users.create({ fullName: "Short" });
    await uiLogin(page, u, "/dashboard/banner");
    await page.getByLabel(/^Name/).fill("W".repeat(60));
    await page.getByLabel(/^Tagline/).fill("T".repeat(90));
    const canvas = page.getByTestId("banner-canvas");
    await page.waitForTimeout(500);
    const preview = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, data: c.toDataURL("image/png") }));
    expect([preview.w, preview.h]).toEqual([1080, 1350]);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    expect(buf.equals(Buffer.from(preview.data.split(",")[1], "base64"))).toBe(true);
    await page.getByLabel("Zoom").isDisabled(); // no portrait yet: crop controls are inert, not broken
    await expect(page.getByRole("button", { name: "Reset zoom and position" })).toBeDisabled();
  });

  for (const vp of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: usable, no overflow, no accessibility violations, export works`, async ({ page, users }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const u = await users.create({ fullName: "Mobile Tester" });
      await uiLogin(page, u, "/dashboard/banner");
      await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await fakePhoto(page) });
      await expect(page.getByText("Drag the preview to reposition the portrait.")).toBeVisible();
      // drag the preview to reposition
      const box = (await page.getByTestId("banner-canvas").boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 3 + 10, { steps: 4 });
      await page.mouse.up();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `page-${vp.name}.png`), fullPage: true });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
      expect(pngSize(fs.readFileSync((await dl.path())!))).toEqual({ w: 1080, h: 1350 });
    });
  }
});
