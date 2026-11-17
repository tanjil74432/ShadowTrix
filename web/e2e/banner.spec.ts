import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { COOKIE, createRawSession, db, expect, test, uiLogin } from "./helpers/fixtures";
import { addPhoto, expectExportMatches, pngSize, samePicture, settle } from "./helpers/banner";

const OUT = path.resolve(__dirname, "../ui-review/banner");
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = () => randomUUID().slice(0, 6);

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

    await addPhoto(page);
    await expect(page.getByText("Drag the preview to reposition the portrait.")).toBeVisible();
    await page.getByLabel("Zoom").fill("1.6");
    await page.getByLabel("Left / right", { exact: true }).fill("0.4");
    await page.getByLabel("Up / down", { exact: true }).fill("-0.3");
    await page.getByLabel(/^Name/).fill("Priyanka Wickramasinghe-Balasubramaniam Longname");
    await page.getByLabel(/^Tagline/).fill("Building things that matter, one commit at a time, together with the whole ShadowTrix community.");
    const canvas = page.getByTestId("banner-canvas");
    await settle(page);
    fs.mkdirSync(OUT, { recursive: true });
    await canvas.screenshot({ path: path.join(OUT, "plain-long-name.png") });

    const preview = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, data: c.toDataURL("image/png") }));
    expect([preview.w, preview.h]).toEqual([1080, 1350]);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^shadowtrix-banner-[a-z0-9-]+\.png$/);
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    await expectExportMatches(page, canvas, preview.data, buf);
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
    await addPhoto(page);
    await settle(page);
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

  test("one universal layout: no role templates, a free identity text above the photo that is not a designation, and every control changes the artwork", async ({ page, users }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const SHOTS = process.env.BANNER_SHOTS ? path.resolve(__dirname, "../../docs/reports/banner-redesign") : OUT;
    fs.mkdirSync(SHOTS, { recursive: true });
    const u = await users.create({ fullName: "Amina Rahman Chowdhury" });
    await uiLogin(page, u, "/dashboard/banner");
    await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();

    // there is nothing to switch between: no template picker at all
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.locator("main").getByText(/template/i)).toHaveCount(0);

    await addPhoto(page);
    await expect(page.getByText("Drag the preview to reposition the portrait.")).toBeVisible();
    const canvas = page.getByTestId("banner-canvas");
    const snap = async () => { await settle(page); return canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png")); };

    // the identity text is decoration: typing a role word there never creates a designation
    const bgText = page.getByLabel(/^Identity text/);
    await expect(bgText).toHaveValue("SHADOW");
    const initial = await snap();
    await bgText.fill("FOUNDER");
    await expect(canvas).toHaveAttribute("aria-label", /identity text FOUNDER/);
    const withFounder = await snap();
    expect(withFounder).not.toBe(initial);
    await expect(page.getByLabel(/^Designation/)).toBeDisabled(); // an ordinary person still has no verified designation
    expect(await page.getByLabel(/^Designation/).locator("option").allTextContents()).toEqual(["None"]);
    expect(await bgText.getAttribute("maxlength")).toBe("24");

    // every background control changes the picture
    const seen = new Set([initial, withFounder]);
    for (const [label, value] of [["Text size", "120"], ["Text position left / right", "0.6"], ["Text position up / down", "-0.7"], ["Text opacity", "0.5"], ["Text rotation", "-9"]] as const) {
      await page.getByLabel(label, { exact: true }).fill(value);
      const now = await snap();
      expect(seen.has(now), `${label} should change the artwork`).toBe(false);
      seen.add(now);
    }
    await page.getByRole("button", { name: "Reset identity text" }).click();
    await expect(bgText).toHaveValue("SHADOW");
    await expect(page.getByLabel("Text size", { exact: true })).toHaveValue("190");
    await expect(page.getByLabel("Text rotation", { exact: true })).toHaveValue("0");
    expect(await samePicture(page, await snap(), initial)).toBe(true); // reset restores the starting artwork

    // optional information appears only when provided and ticked
    await bgText.fill("PARTICIPANT");
    const before = await snap();
    await page.getByLabel(/^University name/).fill("Bangladesh University of Engineering and Technology");
    await page.getByLabel(/^Department/).fill("Computer Science and Engineering");
    await page.getByLabel(/^Event name/).fill("ShadowTrix Spring Hackathon 2026");
    await page.getByLabel(/^Team or organization name/).fill("Team Matrix");
    await page.getByLabel(/^Tagline/).fill("Enter the Matrix of Innovation.");
    const filled = await snap();
    expect(filled).not.toBe(before);
    fs.writeFileSync(path.join(SHOTS, "banner-1-participant.png"), Buffer.from(filled.split(",")[1], "base64"));
    for (const [tick, what] of [["Show university", "university"], ["Show department", "department"], ["Show event name", "event"], ["Show team or organization", "team"], ["Show tagline", "tagline"]] as const) {
      await page.getByLabel(tick, { exact: true }).uncheck();
      const hidden = await snap();
      expect(seen.has(hidden), `hiding ${what} should change the artwork`).toBe(false);
      seen.add(hidden);
    }
    expect(await samePicture(page, await snap(), before)).toBe(true); // everything hidden again: the same as having typed nothing
    for (const tick of ["Show university", "Show department", "Show event name", "Show team or organization", "Show tagline"]) await page.getByLabel(tick, { exact: true }).check();
    expect(await samePicture(page, await snap(), filled)).toBe(true);
    await expect(page.getByLabel("Show verified designation", { exact: true })).toBeChecked();

    // two more looks from the same single layout, then the export equals the preview
    await bgText.fill("TEAM MEMBER");
    await page.getByLabel("Text rotation", { exact: true }).fill("-8");
    await page.getByLabel("Text size", { exact: true }).fill("150");
    await page.getByLabel("Zoom").fill("1.4");
    const second = await snap();
    fs.writeFileSync(path.join(SHOTS, "banner-2-team-member.png"), Buffer.from(second.split(",")[1], "base64"));
    await bgText.fill("JUDGE");
    await page.getByLabel("Text opacity", { exact: true }).fill("0.4");
    await page.getByLabel("Text position up / down", { exact: true }).fill("-0.4");
    await page.getByLabel(/^Name/).fill("Dr. Mohammad Abdul Karim Chowdhury Bhuiyan");
    const third = await snap();
    fs.writeFileSync(path.join(SHOTS, "banner-3-judge.png"), Buffer.from(third.split(",")[1], "base64"));
    expect(new Set([filled, second, third]).size).toBe(3);

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    await expectExportMatches(page, canvas, third, buf);
    await page.setViewportSize({ width: 1440, height: 1900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, "editor-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, "editor-mobile.png"), fullPage: true });
  });

  test("a verified designation stays separate from the identity text, and missing information or maximum-length input still exports a clean 1080 x 1350 banner", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const u = await users.create({ fullName: "Verified Longtext" });
    const mine = await member(u.id, { position: "President" });
    try {
      await uiLogin(page, u, "/dashboard/banner");
      await expect(page.getByLabel(/^Designation/)).toBeEnabled();
      const options = await page.getByLabel(/^Designation/).locator("option").allTextContents();
      expect(options).toEqual(["None", mine.designation!.title]); // only the approved position; "FOUNDER" typed elsewhere cannot add one
      await page.getByLabel(/^Identity text/).fill("FOUNDER");
      expect(await page.getByLabel(/^Designation/).locator("option").allTextContents()).toEqual(options);
      await page.getByLabel(/^Name/).fill("W".repeat(60));
      await page.getByLabel(/^University name/).fill("U".repeat(80));
      await page.getByLabel(/^Department/).fill("D".repeat(80));
      await page.getByLabel(/^Event name/).fill("E".repeat(80));
      await page.getByLabel(/^Team or organization name/).fill("T".repeat(60));
      await page.getByLabel(/^Tagline/).fill("G".repeat(90));
      await page.getByLabel(/^Identity text/).fill("W".repeat(24));
      await page.getByLabel("Text size", { exact: true }).fill("200");
      await page.getByLabel("Text rotation", { exact: true }).fill("12");
      const canvas = page.getByTestId("banner-canvas");
      await settle(page);
      const preview = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, data: c.toDataURL("image/png") }));
      expect([preview.w, preview.h]).toEqual([1080, 1350]);
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
      const buf = fs.readFileSync((await dl.path())!);
      expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
      await expectExportMatches(page, canvas, preview.data, buf);
      await expect(page.getByRole("button", { name: "Reset zoom and position" })).toBeDisabled(); // no portrait yet: crop controls are inert, not broken
    } finally {
      await cleanup([mine]);
    }
  });

  test("the editor and the export still work when a font face cannot be loaded (as on a machine without the fallback font)", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Every explicit font load now rejects with a NetworkError, which is what next/font's local-font fallback does on a Linux machine without that font.
    await page.addInitScript(() => {
      FontFaceSet.prototype.load = () => Promise.reject(new DOMException("A network error occurred.", "NetworkError"));
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const u = await users.create({ fullName: "Fallback Font Person" });
    await uiLogin(page, u, "/dashboard/banner");
    await addPhoto(page);
    await page.getByLabel(/^Identity text/).fill("MY TEAM");
    await page.getByLabel(/^University name/).fill("Test University");
    const canvas = page.getByTestId("banner-canvas");
    await settle(page);
    const preview = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, data: c.toDataURL("image/png") }));
    expect([preview.w, preview.h]).toEqual([1080, 1350]);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    await expectExportMatches(page, canvas, preview.data, buf);
    expect(errors, "a failed font load must not surface as an unhandled error").toEqual([]);
  });

  test("Option A: the identity text is a heading ABOVE the photo, never over it, for short and for very long text", async ({ page, users }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const u = await users.create({ fullName: "Heading Above Photo" });
    await uiLogin(page, u, "/dashboard/banner");
    await addPhoto(page);
    const canvas = page.getByTestId("banner-canvas");
    // A flat, very different colour as the photo, so any text drawn over it would be detected: the frame interior must be pure photo.
    const framePixels = async () => canvas.evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext("2d")!;
      const d = g.getImageData(274, 240, 700, 12).data; // a strip just inside the top of the portrait frame (frame x = 250, y = 215, inner border 14 px)
      let n = 0;
      for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2];
      return n;
    });
    const headingPixels = async () => canvas.evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext("2d")!;
      const d = g.getImageData(250, 22, 750, 168).data; // the heading band above the frame
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++;
      return bright;
    });
    await settle(page);
    const stripWithDefault = await framePixels();
    const brightDefault = await headingPixels();
    expect(brightDefault, "the default heading is drawn in the band above the photo").toBeGreaterThan(2000);
    const field = page.getByLabel(/^Identity text/);
    const shots: Record<string, string> = {};
    for (const [text, size, rotation] of [["I", "200", "0"], ["JUDGE", "200", "12"], ["CO-FOUNDER", "200", "-12"], ["SHADOWTRIX", "200", "0"], ["W".repeat(24), "200", "12"]] as const) {
      await field.fill(text);
      await page.getByLabel("Text size", { exact: true }).fill(size);
      await page.getByLabel("Text rotation", { exact: true }).fill(rotation);
      await settle(page);
      expect(await framePixels(), `"${text}" must not be drawn over the portrait`).toBe(stripWithDefault);
      expect(await headingPixels(), `"${text}" is drawn above the photo`).toBeGreaterThan(300);
      shots[text] = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
    }
    expect(new Set(Object.values(shots)).size).toBe(5); // each text gives its own picture
    await field.fill("");
    await settle(page);
    expect(await headingPixels(), "an empty identity text draws no heading").toBeLessThan(brightDefault / 4);
    expect(await framePixels()).toBe(stripWithDefault);
  });

  for (const vp of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: usable, no overflow, no accessibility violations, export works`, async ({ page, users }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const u = await users.create({ fullName: "Mobile Tester" });
      await uiLogin(page, u, "/dashboard/banner");
      await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();
      await addPhoto(page);
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
