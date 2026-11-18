import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LEADERSHIP_TEMPLATE, DEFAULT_MEMBER_STYLE, leadershipTemplateSchema, memberStyleKey, memberStyleSchema, parseMemberStyle, parseTemplate, TEMPLATE_KEY, TEXT_COLORS, TYPO_PRESETS } from "@/lib/leadership/template";
import { getDb } from "@/server/db/client";
import { deleteMemberStyle, getLeadershipTemplate, getMemberStyle, resetLeadershipTemplate, saveLeadershipTemplate, saveMemberStyle } from "@/server/modules/organization/leadership-template.service";
import * as org from "@/server/modules/organization/organization.service";
import { setStorageForTests } from "@/server/storage";
import { createLocalStorage } from "@/server/storage/local-storage";
import { actorOf, cleanup, createUser } from "./helpers/auth-harness";

let dir: string;
beforeAll(async () => {
  WEBP = await raster("webp");
  dir = mkdtempSync(join(tmpdir(), "st-test-lead-"));
  setStorageForTests(createLocalStorage(dir));
});
const members: string[] = [];
const units: string[] = [];
const designations: string[] = [];
afterEach(async () => {
  const db = getDb();
  await db.siteSetting.deleteMany({ where: { OR: [{ key: TEMPLATE_KEY }, { key: { startsWith: "leadership_member:" } }] } });
  await db.orgMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  await db.orgUnit.deleteMany({ where: { id: { in: units.splice(0) } } });
  await db.designation.deleteMany({ where: { id: { in: designations.splice(0) } } });
  await db.auditLog.deleteMany({ where: { action: { in: ["admin.leadership_template_saved", "admin.leadership_template_reset", "admin.org_member_card_saved"] } } });
  await cleanup();
});
afterAll(async () => {
  setStorageForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  await getDb().$disconnect();
});

const admin = async () => actorOf(await createUser({ roles: ["ADMIN"] }));
const tag = () => Math.random().toString(36).slice(2, 8);

/** A real, valid PNG: `alpha` 0 = fully transparent pixel, 255 = opaque. Colour type 6 (RGBA). */
function png(alpha: number, w = 4, h = 4): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [240, 120, 50, alpha]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
/** A real WebP with a half-transparent pixel, made by the image library once for the file. */
let WEBP = new Uint8Array();
const webp = () => WEBP;
const raster = (fmt: "png" | "jpeg" | "webp", w = 8, h = 8) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 240, g: 120, b: 50, alpha: 0.5 } } })[fmt]().toBuffer().then((x) => new Uint8Array(x));

async function publishedMember(opts: { published?: boolean; placeholder?: boolean; unitActive?: boolean; name?: string } = {}) {
  const db = getDb();
  const t = tag();
  const unit = await db.orgUnit.create({ data: { slug: `lt-${t}`, name: `LT Unit ${t}`, isActive: opts.unitActive ?? true } });
  units.push(unit.id);
  const des = await db.designation.create({ data: { title: `LT Designation ${t}`, rankOrder: 1 } });
  designations.push(des.id);
  const m = await db.orgMember.create({
    data: { slug: `lt-${t}`, fullName: opts.name ?? `LT Member ${t}`, department: "CSE", visibility: opts.published === false ? "DRAFT" : "PUBLISHED", isPlaceholder: opts.placeholder ?? false },
  });
  members.push(m.id);
  await db.orgMembership.create({ data: { memberId: m.id, unitId: unit.id, designationId: des.id } });
  return { m, unit, des };
}

describe("template schema", () => {
  it("applies the default design to nothing, and accepts a partial design by filling in the rest", () => {
    expect(leadershipTemplateSchema.parse({})).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    const t = leadershipTemplateSchema.parse({ typography: { size: 22 } });
    expect(t.typography.size).toBe(22);
    expect(t.typography.preset).toBe(DEFAULT_LEADERSHIP_TEMPLATE.typography.preset);
    expect(t.board).toEqual(DEFAULT_LEADERSHIP_TEMPLATE.board);
  });

  it("clamps and validates: out-of-range numbers, bad colours, unknown fonts and palettes are refused", () => {
    for (const bad of [
      { typography: { size: 500 } }, { typography: { size: 25 } }, { typography: { size: 1 } }, { typography: { opacity: 2 } }, { typography: { color: "orange" } }, { typography: { color: "#ggg000" } },
      { typography: { color: "#ff9a55" } }, { typography: { color: "#F4F4F6" } }, { typography: { preset: "comic-sans" } }, { typography: { preset: 3 } }, { typography: { rotation: 90 } }, { background: { grid: 101 } }, { background: { base: "#ffffff" } },
      { background: { accent: "#00ff00" } }, { portrait: { zoom: 9 } }, { portrait: { align: "top" } }, { board: { nameSize: 50 } }, { board: { border: "dotted" } }, { board: { showUnit: "yes" } },
      { typography: { size: "22" } }, { typography: { size: null } }, { typography: { size: NaN } },
    ]) expect(leadershipTemplateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    // exactly the three colours and five presets are accepted
    for (const color of TEXT_COLORS) expect(leadershipTemplateSchema.parse({ typography: { color } }).typography.color).toBe(color);
    for (const preset of TYPO_PRESETS) expect(leadershipTemplateSchema.parse({ typography: { preset } }).typography.preset).toBe(preset);
    expect(TEXT_COLORS).toHaveLength(3);
    expect(TYPO_PRESETS).toHaveLength(5);
  });

  it("a template saved before the presets existed is still read: its other settings survive, the old font and weight are dropped, the colour maps to the nearest allowed one", () => {
    const legacy = (typography: object) => parseTemplate({ background: { grid: 12 }, typography });
    const a = legacy({ font: "mono", weight: 900, color: "#ff9a55", size: 20, x: 5 });
    expect(a.background.grid).toBe(12);
    expect(a.typography).toMatchObject({ size: 20, x: 5, preset: DEFAULT_LEADERSHIP_TEMPLATE.typography.preset, color: "#f07832" });
    expect(legacy({ size: 40 }).typography.size).toBe(24); // the size control used to go up to 40; it now tops out at "fills the card"
    expect(legacy({ color: "#d4d4d4" }).typography.color).toBe("#f4f4f6");
    expect(legacy({ color: "#22cc88" }).typography.color).toBe("#2ee59d");
    expect(parseTemplate({ typography: { size: "huge", color: "#ff9a55" } })).toEqual(DEFAULT_LEADERSHIP_TEMPLATE); // damaged data still falls back to the default design
  });

  it("the public reader never fails: invalid stored data falls back to the default design", () => {
    expect(parseTemplate(null)).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    expect(parseTemplate({ typography: { size: "huge" } })).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    expect(parseTemplate("garbage")).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    expect(parseMemberStyle({ zoom: 99 })).toEqual(DEFAULT_MEMBER_STYLE);
  });

  it("member style: zoom, position and decorative text are bounded; control characters are removed; the text is trimmed", () => {
    expect(memberStyleSchema.parse({ text: "  FOUNDER\u0000\u0007  " }).text).toBe("FOUNDER");
    expect(memberStyleSchema.safeParse({ text: "x".repeat(41) }).success).toBe(false);
    for (const bad of [{ zoom: 0 }, { zoom: 4 }, { x: 80 }, { y: -80 }, { textScale: 3 }, { textX: 99 }]) expect(memberStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("saving the template and member styles (administrators only)", () => {
  it("only an administrator may change anything; everyone else is refused (403) and nothing is written", async () => {
    const outsiders = [actorOf(await createUser()), actorOf(await createUser({ roles: ["ORGANIZER"] })), actorOf(await createUser({ roles: ["JUDGE"] }))];
    const { m } = await publishedMember();
    for (const a of outsiders) {
      await expect(saveLeadershipTemplate(a, {})).rejects.toMatchObject({ status: 403 });
      await expect(resetLeadershipTemplate(a)).rejects.toMatchObject({ status: 403 });
      await expect(saveMemberStyle(a, m.id, {})).rejects.toMatchObject({ status: 403 });
    }
    expect(await getDb().siteSetting.count({ where: { OR: [{ key: TEMPLATE_KEY }, { key: { startsWith: "leadership_member:" } }] } })).toBe(0);
  });

  it("an event-scoped administrator grant is not enough", async () => {
    await expect(saveLeadershipTemplate({ id: "00000000-0000-4000-8000-000000000001", roles: [{ role: "ADMIN", eventId: "00000000-0000-4000-8000-0000000000aa" }] }, {})).rejects.toMatchObject({ status: 403 });
  });

  it("the template persists across reads, can be reset, and every change is audited", async () => {
    const a = await admin();
    expect(await getLeadershipTemplate()).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    const saved = await saveLeadershipTemplate(a, { typography: { size: 17, text: "ignored" }, background: { glow: 80 }, board: { showBio: true } });
    expect(saved.typography.size).toBe(17);
    expect(saved).not.toHaveProperty("typography.text");
    const again = await getLeadershipTemplate(); // a fresh read, as after a page reload
    expect(again).toEqual(saved);
    expect(again.background.glow).toBe(80);
    expect(again.board.showBio).toBe(true);
    expect(await resetLeadershipTemplate(a)).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    expect(await getLeadershipTemplate()).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    const rows = await getDb().auditLog.findMany({ where: { actorId: a.id, action: { startsWith: "admin.leadership_template" } }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["admin.leadership_template_saved", "admin.leadership_template_reset"]);
  });

  it("invalid input is refused with a 400-style validation error and leaves the saved template untouched", async () => {
    const a = await admin();
    await saveLeadershipTemplate(a, { typography: { size: 20 } });
    await expect(saveLeadershipTemplate(a, { typography: { size: 500 } })).rejects.toThrow();
    await expect(saveLeadershipTemplate(a, { typography: { color: "javascript:alert(1)" } })).rejects.toThrow();
    expect((await getLeadershipTemplate()).typography.size).toBe(20);
  });

  it("a member's style persists, is audited, needs an existing member, and goes away with the member", async () => {
    const a = await admin();
    const { m } = await publishedMember();
    const saved = await saveMemberStyle(a, m.id, { zoom: 1.4, x: 6, y: -4, text: "FOUNDER", textScale: 1.2 });
    expect(await getMemberStyle(m.id)).toEqual(saved);
    expect(saved.text).toBe("FOUNDER");
    await expect(saveMemberStyle(a, "00000000-0000-4000-8000-00000000dead", {})).rejects.toMatchObject({ status: 404 });
    expect(await getDb().auditLog.count({ where: { actorId: a.id, action: "admin.org_member_card_saved", entityId: m.id } })).toBe(1);
    await org.deleteMember(a, m.id);
    members.pop();
    expect(await getDb().siteSetting.count({ where: { key: memberStyleKey(m.id) } })).toBe(0);
    await deleteMemberStyle(m.id); // harmless when there is nothing to delete
  });
});

describe("what the public pages receive: getPublicTeam()", () => {
  const team = () => org.getPublicTeam();
  const ids = async () => (await team()).units.flatMap((u) => u.people.map((p) => p.id));

  it("lists only verified, published members of active units; drafts, placeholders and inactive units never appear", async () => {
    const shown = await publishedMember();
    const draft = await publishedMember({ published: false });
    const placeholder = await publishedMember({ placeholder: true });
    const inactive = await publishedMember({ unitActive: false });
    const got = await ids();
    expect(got).toContain(shown.m.id);
    for (const hidden of [draft, placeholder, inactive]) expect(got).not.toContain(hidden.m.id);
  });

  it("carries the shared template, the member's own style, the unit slug and a photo fingerprint (never the storage key)", async () => {
    const a = await admin();
    const { m, unit } = await publishedMember();
    await saveLeadershipTemplate(a, { typography: { size: 22 } });
    await saveMemberStyle(a, m.id, { text: "SHADOW", zoom: 1.2 });
    await org.setMemberPhoto(a, m.id, { name: "me.png", declaredMime: "image/png", bytes: png(0) });
    const result = await team();
    expect(result.template.typography.size).toBe(22);
    const u = result.units.find((x) => x.id === unit.id)!;
    expect(u.slug).toBe(unit.slug);
    const p = u.people.find((x) => x.id === m.id)!;
    expect(p.style).toMatchObject({ text: "SHADOW", zoom: 1.2 });
    expect(p.hasPhoto).toBe(true);
    expect(p.photoVersion).toMatch(/^[0-9a-f]{8}$/);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/org-members\/[0-9a-f-]{36}\//); // no storage key
    expect(json).not.toMatch(/photoKey|passwordHash|"email":"[^"]/);
  });

  it("without a saved template or style the defaults apply, so a freshly published member renders correctly", async () => {
    const { m } = await publishedMember();
    const result = await team();
    expect(result.template).toEqual(DEFAULT_LEADERSHIP_TEMPLATE);
    expect(result.units.flatMap((u) => u.people).find((p) => p.id === m.id)!.style).toBeNull();
  });

  it("publishing and un-publishing through the existing member update changes visibility at once", async () => {
    const a = await admin();
    const { m } = await publishedMember({ published: false });
    expect(await ids()).not.toContain(m.id);
    await org.updateMember(a, m.id, { visibility: "PUBLISHED", isPlaceholder: false });
    expect(await ids()).toContain(m.id);
    await org.updateMember(a, m.id, { visibility: "DRAFT" });
    expect(await ids()).not.toContain(m.id);
  });
});

describe("portraits keep their transparency", () => {
  it("a transparent PNG is stored and served byte for byte (RGBA, alpha 0 stays 0), never re-encoded", async () => {
    const a = await admin();
    const { m } = await publishedMember();
    const original = png(0);
    await org.setMemberPhoto(a, m.id, { name: "cutout.png", declaredMime: "image/png", bytes: original });
    const { bytes, mime } = await org.getMemberPhoto(null, m.id);
    expect(mime).toBe("image/png");
    expect(Buffer.from(bytes).equals(Buffer.from(original))).toBe(true);
    expect(bytes[25]).toBe(6); // IHDR colour type 6 = RGBA: the alpha channel is still there
  });

  it("WebP portraits are accepted for members and served as image/webp, unchanged", async () => {
    const a = await admin();
    const { m } = await publishedMember();
    await org.setMemberPhoto(a, m.id, { name: "cutout.webp", declaredMime: "image/webp", bytes: webp() });
    const { bytes, mime } = await org.getMemberPhoto(null, m.id);
    expect(mime).toBe("image/webp");
    expect(Buffer.from(bytes).equals(Buffer.from(webp()))).toBe(true);
  });

  it("types, content and size are validated: fake or oversized files, SVG and wrong declared types are refused", async () => {
    const a = await admin();
    const { m } = await publishedMember();
    const bad = (name: string, declaredMime: string, bytes: Uint8Array) => expect(org.setMemberPhoto(a, m.id, { name, declaredMime, bytes })).rejects.toMatchObject({ code: "invalid_file" });
    await bad("x.webp", "image/webp", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])); // not RIFF/WEBP
    await bad("x.webp", "image/png", webp()); // declared type does not match
    await bad("x.webp", "image/webp", new Uint8Array(0));
    await bad("x.svg", "image/svg+xml", new Uint8Array([60, 115]));
    await bad("x.gif", "image/gif", new Uint8Array([0x47, 0x49, 0x46, 0x38]));
    await bad("x.png", "image/png", new Uint8Array([1, 2, 3, 4]));
    await bad("big.png", "image/png", new Uint8Array(2 * 1024 * 1024 + 1).map((_, i) => (i < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i] : 1)));
    await bad("big.webp", "image/webp", new Uint8Array(2 * 1024 * 1024 + 1).map((_, i) => ("RIFF".charCodeAt(i) || (i >= 8 && i < 12 ? "WEBP".charCodeAt(i - 8) : 1))));
  });

  it("portraits must actually decode: damaged, truncated, mislabelled, animated or oversized images are refused; valid transparent images are stored untouched", async () => {
    const a = await admin();
    const { m } = await publishedMember();
    const bad = (name: string, declaredMime: string, bytes: Uint8Array) => expect(org.setMemberPhoto(a, m.id, { name, declaredMime, bytes })).rejects.toMatchObject({ code: "invalid_file" });
    const png8 = await raster("png"), jpg8 = await raster("jpeg"), webp8 = await raster("webp");
    // a valid header on garbage: the old header-only check accepted these
    await bad("a.png", "image/png", new Uint8Array([...png8.slice(0, 33), 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    await bad("a.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2]));
    await bad("a.webp", "image/webp", new Uint8Array([...Buffer.from("RIFF"), 12, 0, 0, 0, ...Buffer.from("WEBPVP8 "), 0, 0, 0, 0, 0, 0, 0, 0]));
    // truncated copies of real files
    await bad("t.png", "image/png", png8.slice(0, Math.floor(png8.length / 2)));
    await bad("t.jpg", "image/jpeg", jpg8.slice(0, Math.floor(jpg8.length / 2)));
    await bad("t.webp", "image/webp", webp8.slice(0, Math.floor(webp8.length / 2)));
    // a real image of another format behind the wrong extension
    await bad("lie.png", "image/png", jpg8);
    await bad("lie.jpg", "image/jpeg", png8);
    // a decompression bomb: tiny file, huge canvas (well under 2 MB, over the pixel limit)
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(2 * 1024 * 1024);
    await bad("huge.png", "image/png", new Uint8Array(huge));
    expect(await getDb().orgMember.findUniqueOrThrow({ where: { id: m.id } }).then((x) => x.photoKey)).toBeNull(); // nothing was stored by any refusal
    // valid ones are accepted and kept byte for byte, with their transparency
    for (const [name, mime, bytes] of [["ok.png", "image/png", png8], ["ok.webp", "image/webp", webp8]] as const) {
      await org.setMemberPhoto(a, m.id, { name, declaredMime: mime, bytes });
      const stored = await org.getMemberPhoto(null, m.id);
      expect(Buffer.from(stored.bytes).equals(Buffer.from(bytes))).toBe(true);
      expect((await sharp(Buffer.from(stored.bytes)).metadata()).hasAlpha).toBe(true);
    }
    await org.setMemberPhoto(a, m.id, { name: "ok.jpg", declaredMime: "image/jpeg", bytes: jpg8 });
    expect((await org.getMemberPhoto(null, m.id)).mime).toBe("image/jpeg");
  });

  it("a member's contact email is public only while they opted in, decided on the server for the homepage and the team page", async () => {
    const { m } = await publishedMember();
    const email = `lt-private-${tag()}@example.test`;
    const find = async () => {
      const team = await org.getPublicTeam();
      const hit = [...team.units.flatMap((u) => u.people), ...team.former].find((p) => p.id === m.id);
      return { hit, wire: JSON.stringify(team) };
    };
    await getDb().orgMember.update({ where: { id: m.id }, data: { email, emailPublic: false } });
    let r = await find();
    expect(r.hit?.email).toBeNull();
    expect(r.wire).not.toContain(email); // not in any field of the data the pages are built from
    await getDb().orgMember.update({ where: { id: m.id }, data: { emailPublic: true } });
    r = await find();
    expect(r.hit?.email).toBe(email);
    await getDb().orgMember.update({ where: { id: m.id }, data: { emailPublic: false } }); // turned off again: gone immediately
    r = await find();
    expect(r.hit?.email).toBeNull();
    expect(r.wire).not.toContain(email);
  });

  it("a draft member's portrait is private; an administrator can still see it", async () => {
    const a = await admin();
    const { m } = await publishedMember({ published: false });
    await org.setMemberPhoto(a, m.id, { name: "p.png", declaredMime: "image/png", bytes: png(0) });
    await expect(org.getMemberPhoto(null, m.id)).rejects.toMatchObject({ status: 404 });
    await expect(org.getMemberPhoto(a, m.id)).resolves.toBeDefined();
  });
});
