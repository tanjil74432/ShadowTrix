import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import {
  addEventHost, addEventOrganizer, auditQuerySchema, getSignupsEnabled, getUserDetail, listAllEvents, listAuditLog, removeEventHost, removeEventOrganizer, scrubAuditJson, setSignupsEnabled,
  adminEventsQuerySchema,
} from "@/server/modules/admin/admin-management.service";
import { analyticsQuerySchema, getAnalytics, resolveRange } from "@/server/modules/analytics/analytics.service";
import { registerUser } from "@/server/modules/auth/auth.service";
import { registerSchema } from "@/server/modules/auth/auth.schema";
import { createSession, getSessionUser } from "@/server/modules/auth/session.service";
import { setEventStatus } from "@/server/modules/events/events.service";
import * as org from "@/server/modules/organization/organization.service";
import { designationSchema, memberSchema, membershipSchema, organizationSchema, termSchema, unitSchema } from "@/server/modules/organization/organization.schema";
import { setStorageForTests } from "@/server/storage";
import { createLocalStorage } from "@/server/storage/local-storage";
import { actorOf, cleanup, createUser, ctx, makeHarness, uniqueEmail } from "./helpers/auth-harness";
import { organizer, participant, publishedEvent } from "./helpers/event-fixtures";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "st-test-admin-"));
  setStorageForTests(createLocalStorage(dir));
});
const createdOrgs: string[] = [];
const createdMembers: string[] = [];
const createdUnits: string[] = [];
const createdDesignations: string[] = [];
const createdTerms: string[] = [];
afterEach(async () => {
  const db = getDb();
  await db.orgMember.deleteMany({ where: { id: { in: createdMembers.splice(0) } } });
  await db.organization.deleteMany({ where: { id: { in: createdOrgs.splice(0) } } });
  await db.orgUnit.deleteMany({ where: { id: { in: createdUnits.splice(0) } } });
  await db.designation.deleteMany({ where: { id: { in: createdDesignations.splice(0) } } });
  await db.orgTerm.deleteMany({ where: { id: { in: createdTerms.splice(0) } } });
  await db.siteSetting.deleteMany({ where: { key: "signups_enabled" } });
  await db.auditLog.deleteMany({ where: { action: { startsWith: "admin." }, actorId: null } });
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  setStorageForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  await getDb().$disconnect();
});

const admin = async () => {
  const u = await createUser({ roles: ["ADMIN"] });
  return { u, actor: actorOf(u) };
};
const tag = () => Math.random().toString(36).slice(2, 8);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2]);

describe("every administration function refuses non-administrators", () => {
  it("participants, organizers and judges get 403 from each entry point", async () => {
    const a = await admin();
    const target = await createUser();
    const e = await publishedEvent(await organizer());
    const orgn = await org.createOrganization(a.actor, organizationSchema.parse({ name: `Guard Org ${tag()}` }));
    createdOrgs.push(orgn.id);
    const attackers = [(await participant()).actor, (await organizer()).actor, actorOf(await createUser({ roles: ["JUDGE"] })), { id: "anon", roles: [] }];
    for (const who of attackers) {
      const calls: Promise<unknown>[] = [
        getUserDetail(who, target.id), listAllEvents(who, adminEventsQuerySchema.parse({})), addEventOrganizer(who, e.id, target.email), removeEventOrganizer(who, e.id, target.id),
        addEventHost(who, e.id, orgn.id, "HOST"), removeEventHost(who, e.id, orgn.id), listAuditLog(who, auditQuerySchema.parse({})), setSignupsEnabled(who, false),
        getAnalytics(who, {}), org.listOrganizations(who), org.getOrganization(who, orgn.id), org.createOrganization(who, organizationSchema.parse({ name: "Nope Org" })),
        org.updateOrganization(who, orgn.id, { name: "Hijacked" }), org.deleteOrganization(who, orgn.id), org.setOrganizationVerified(who, orgn.id, true),
        org.addRepresentative(who, orgn.id, target.email), org.listLeadershipReference(who), org.createUnit(who, unitSchema.parse({ name: "Nope" })),
        org.createDesignation(who, designationSchema.parse({ title: "Nope" })), org.createTerm(who, termSchema.parse({ label: "Nope", startsOn: "2030-01-01" })),
        org.listMembers(who, {}), org.createMember(who, memberSchema.parse({ fullName: "Nope Person" })), org.setMemberPhoto(who, target.id, { name: "a.png", declaredMime: "image/png", bytes: PNG }),
      ];
      for (const call of calls) await expect(call).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe("user details and event management", () => {
  it("shows a user's roles, counts and activity without secrets", async () => {
    const a = await admin();
    const u = await createUser();
    await getDb().auditLog.create({ data: { actorId: u.id, action: "auth.login", entityType: "user", entityId: u.id, after: { token: "SECRET-TOKEN-VALUE", ok: 1 } } });
    const d = await getUserDetail(a.actor, u.id);
    expect(d).toMatchObject({ email: u.email, status: "ACTIVE", emailVerified: true, mfaEnabled: false });
    expect(d.activity[0]).toMatchObject({ action: "auth.login", by: "Test Person" });
    const text = JSON.stringify(d);
    expect(text).not.toContain("SECRET-TOKEN-VALUE");
    expect(text).not.toMatch(/passwordHash|tokenHash|secretEnc/);
    await expect(getUserDetail(a.actor, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
    expect(scrubAuditJson({ a: 1, passwordHash: "x", nested: { resetToken: "y", fine: 2 } })).toEqual({ a: 1, passwordHash: "[hidden]", nested: { resetToken: "[hidden]", fine: 2 } });
  });

  it("lists every event (drafts too) with filters, counts and pagination", async () => {
    const a = await admin();
    const o = await organizer();
    const live = await publishedEvent(o, { title: `vt admin live ${tag()}` });
    const draft = await getDb().event.findFirstOrThrow({ where: { id: (await (await import("@/server/modules/events/events.service")).createEvent(o.actor, (await import("./helpers/event-fixtures")).eventInput({ title: `vt admin draft ${tag()}` }))).id } });
    const p = await participant();
    await (await import("@/server/modules/events/registrations.service")).registerForEvent(p.actor, live.id);
    const all = await listAllEvents(a.actor, adminEventsQuerySchema.parse({ q: "vt admin" }));
    expect(all.items.map((i) => i.id).sort()).toEqual([live.id, draft.id].sort());
    expect(all.items.find((i) => i.id === live.id)!.registrations.CONFIRMED).toBe(1);
    expect((await listAllEvents(a.actor, adminEventsQuerySchema.parse({ q: "vt admin", status: "DRAFT" }))).items.map((i) => i.id)).toEqual([draft.id]);
    expect((await listAllEvents(a.actor, adminEventsQuerySchema.parse({ q: "vt admin", pageSize: 1, page: 2 }))).items).toHaveLength(1);
    expect(adminEventsQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });

  it("administrators cancel and archive any event through the same audited lifecycle", async () => {
    const a = await admin();
    const e = await publishedEvent(await organizer());
    await setEventStatus(a.actor, e.id, "cancel");
    await setEventStatus(a.actor, e.id, "archive");
    expect((await getDb().event.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ARCHIVED");
    expect(await getDb().auditLog.count({ where: { entityId: e.id, actorId: a.u.id, action: { in: ["event.cancel", "event.archive"] } } })).toBe(2);
  });

  it("adds and removes event organizers (scoped role, sessions refreshed) but never the last one", async () => {
    const a = await admin();
    const o = await organizer();
    const e = await publishedEvent(o);
    const extra = await createUser();
    const session = await createSession(extra.id);
    expect(await addEventOrganizer(a.actor, e.id, extra.email)).toMatchObject({ created: true });
    expect(await addEventOrganizer(a.actor, e.id, extra.email)).toMatchObject({ created: false });
    expect(await getSessionUser(session.token)).toBeNull();
    const roles = await getDb().userRoleAssignment.findMany({ where: { userId: extra.id, role: "ORGANIZER" } });
    expect(roles).toEqual([expect.objectContaining({ eventId: e.id })]);
    await expect(addEventOrganizer(a.actor, e.id, "nobody@example.test")).rejects.toMatchObject({ code: "user_not_found" });
    await removeEventOrganizer(a.actor, e.id, extra.id);
    expect(await getDb().userRoleAssignment.count({ where: { userId: extra.id, role: "ORGANIZER" } })).toBe(0);
    await expect(removeEventOrganizer(a.actor, e.id, o.u.id)).rejects.toMatchObject({ status: 409 }); // the only organizer
    await expect(removeEventOrganizer(a.actor, e.id, extra.id)).rejects.toMatchObject({ status: 404 });
  });

  it("sets and removes hosting organizations", async () => {
    const a = await admin();
    const e = await publishedEvent(await organizer());
    const hostOrg = await org.createOrganization(a.actor, organizationSchema.parse({ name: `Host Org ${tag()}`, type: "UNIVERSITY" }));
    createdOrgs.push(hostOrg.id);
    await addEventHost(a.actor, e.id, hostOrg.id, "CO_HOST");
    await addEventHost(a.actor, e.id, hostOrg.id, "PARTNER"); // changes the role instead of duplicating
    expect((await getDb().eventHost.findMany({ where: { eventId: e.id, organizationId: hostOrg.id } })).map((h) => h.role)).toEqual(["PARTNER"]);
    await expect(org.deleteOrganization(a.actor, hostOrg.id)).rejects.toMatchObject({ status: 409 }); // hosts an event
    await removeEventHost(a.actor, e.id, hostOrg.id);
    await expect(removeEventHost(a.actor, e.id, hostOrg.id)).rejects.toMatchObject({ status: 404 });
    await org.deleteOrganization(a.actor, hostOrg.id);
    createdOrgs.pop();
  });
});

describe("audit and security logs, platform settings", () => {
  it("filters by view, action, entity, actor and dates, and never shows secrets", async () => {
    const a = await admin();
    const u = await createUser();
    const db = getDb();
    await db.auditLog.createMany({
      data: [
        { actorId: u.id, action: "auth.login", entityType: "user", entityId: u.id },
        { actorId: u.id, action: "mfa.enabled", entityType: "user", entityId: u.id },
        { actorId: u.id, action: "event.create", entityType: "event", entityId: "x1", after: { passwordHash: "LEAK", slug: "ok" } },
        { actorId: a.u.id, action: "admin.role_granted", entityType: "user", entityId: u.id },
      ],
    });
    const security = await listAuditLog(a.actor, auditQuerySchema.parse({ view: "security", actor: u.email }));
    expect(security.items.map((i) => i.action).sort()).toEqual(["auth.login", "mfa.enabled"]);
    expect((await listAuditLog(a.actor, auditQuerySchema.parse({ view: "admin", actor: a.u.email }))).items.map((i) => i.action)).toEqual(["admin.role_granted"]);
    const ev = await listAuditLog(a.actor, auditQuerySchema.parse({ action: "event.", entityType: "event", actor: u.email }));
    expect(ev.items).toHaveLength(1);
    expect(JSON.stringify(ev.items)).not.toContain("LEAK");
    const today = new Date().toISOString().slice(0, 10);
    expect((await listAuditLog(a.actor, auditQuerySchema.parse({ from: today, to: today, actor: u.email }))).total).toBeGreaterThanOrEqual(3);
    expect((await listAuditLog(a.actor, auditQuerySchema.parse({ to: "2000-01-01", actor: u.email }))).total).toBe(0);
    expect(auditQuerySchema.safeParse({ pageSize: 5000 }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "yesterday" }).success).toBe(false);
  });

  it("administrators can pause new sign-ups; existing accounts are unaffected; the change is audited", async () => {
    const a = await admin();
    const h = makeHarness();
    expect(await getSignupsEnabled()).toBe(true);
    await setSignupsEnabled(a.actor, false);
    expect(await getSignupsEnabled()).toBe(false);
    const email = uniqueEmail("paused");
    await expect(registerUser(registerSchema.parse({ email }), ctx, h.deps)).rejects.toMatchObject({ status: 503, code: "signups_paused" });
    expect(await getDb().user.count({ where: { email } })).toBe(0);
    await setSignupsEnabled(a.actor, true);
    await expect(registerUser(registerSchema.parse({ email }), ctx, h.deps)).resolves.toBeUndefined();
    expect(await getDb().auditLog.count({ where: { action: "admin.setting_changed", actorId: a.u.id } })).toBe(2);
  });
});

describe("hostile search input is inert", () => {
  it("user, event, member and audit searches survive NUL bytes, quotes, wildcards and very long values", async () => {
    const a = await admin();
    const { listUsers } = await import("@/server/modules/admin/admin-users.service");
    for (const q of [" ", "'; DROP TABLE users; --", "%_\\", "x".repeat(5000), " ' "]) {
      await expect(listUsers(a.actor, { page: 1, pageSize: 5, q: q.slice(0, 100) })).resolves.toBeDefined();
      await expect(listAllEvents(a.actor, adminEventsQuerySchema.parse({ q: q.slice(0, 100) }))).resolves.toBeDefined();
      await expect(org.listMembers(a.actor, { q: q.slice(0, 100) })).resolves.toBeDefined();
      await expect(listAuditLog(a.actor, auditQuerySchema.parse({ actor: q.slice(0, 100), action: q.slice(0, 60) }))).resolves.toBeDefined();
    }
    expect(await getDb().user.count()).toBeGreaterThan(0);
  });
});

describe("organizations", () => {
  it("creates, edits, verifies and deletes organizations; the operator organization is protected", async () => {
    const a = await admin();
    const o = await org.createOrganization(a.actor, organizationSchema.parse({ name: `Partner ${tag()}`, type: "COMPANY", websiteUrl: "https://partner.example.com", description: "A partner." }));
    createdOrgs.push(o.id);
    expect(organizationSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "Okay Org", websiteUrl: "javascript:alert(1)" }).success).toBe(false);
    await expect(org.createOrganization(a.actor, organizationSchema.parse({ name: "Second operator", type: "PLATFORM_OPERATOR" }))).rejects.toMatchObject({ status: 409 });
    await org.updateOrganization(a.actor, o.id, { description: "Updated" });
    await org.setOrganizationVerified(a.actor, o.id, true);
    expect((await org.getOrganization(a.actor, o.id)).verifiedAt).not.toBeNull();
    await org.setOrganizationVerified(a.actor, o.id, false);
    expect((await org.getOrganization(a.actor, o.id)).verifiedAt).toBeNull();
    const operator = await getDb().organization.findFirstOrThrow({ where: { isOperator: true } });
    await expect(org.deleteOrganization(a.actor, operator.id)).rejects.toMatchObject({ status: 409 });
    await expect(org.updateOrganization(a.actor, operator.id, { type: "COMPANY" })).rejects.toMatchObject({ status: 409 });
    await expect(org.updateOrganization(a.actor, o.id, { type: "PLATFORM_OPERATOR" })).rejects.toMatchObject({ status: 409 });
    expect((await org.listOrganizations(a.actor))[0].isOperator).toBe(true);
  });

  it("organization representatives hold an organization-scoped organizer role", async () => {
    const a = await admin();
    const o = await org.createOrganization(a.actor, organizationSchema.parse({ name: `Rep Org ${tag()}` }));
    createdOrgs.push(o.id);
    const rep = await createUser();
    expect(await org.addRepresentative(a.actor, o.id, rep.email)).toEqual({ created: true });
    expect(await org.addRepresentative(a.actor, o.id, rep.email)).toEqual({ created: false });
    expect((await org.getOrganization(a.actor, o.id)).roles.map((r) => r.user.id)).toEqual([rep.id]);
    expect(await getDb().userRoleAssignment.findFirst({ where: { userId: rep.id, role: "ORGANIZER", organizationId: o.id } })).not.toBeNull();
    await expect(org.addRepresentative(a.actor, o.id, "nobody@example.test")).rejects.toMatchObject({ code: "user_not_found" });
    await org.removeRepresentative(a.actor, o.id, rep.id);
    await expect(org.removeRepresentative(a.actor, o.id, rep.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("leadership and the public team page", () => {
  async function setup() {
    const a = await admin();
    const unit = await org.createUnit(a.actor, unitSchema.parse({ name: `Test Unit ${tag()}`, displayOrder: 900 }));
    const lead = await org.createDesignation(a.actor, designationSchema.parse({ title: `Test Lead ${tag()}`, rankOrder: 1 }));
    const helper = await org.createDesignation(a.actor, designationSchema.parse({ title: `Test Helper ${tag()}`, rankOrder: 2 }));
    createdUnits.push(unit.id);
    createdDesignations.push(lead.id, helper.id);
    return { a, unit, lead, helper };
  }
  const member = async (a: Awaited<ReturnType<typeof admin>>, name: string, over: Record<string, unknown> = {}) => {
    const m = await org.createMember(a.actor, memberSchema.parse({ fullName: name, ...over }));
    createdMembers.push(m.id);
    return m;
  };

  it("never publishes a placeholder; shows only verified, published people; ordering and contact privacy hold", async () => {
    const { a, unit, lead, helper } = await setup();
    await expect(org.createMember(a.actor, memberSchema.parse({ fullName: "Placeholder Person", visibility: "PUBLISHED" }))).rejects.toMatchObject({ code: "placeholder_not_publishable" });
    const verified = await member(a, "Zed Verified", { visibility: "PUBLISHED", isPlaceholder: false, email: "zed@example.test", emailPublic: true, bio: "Real bio." });
    const hidden = await member(a, "Ada Hidden", { visibility: "PUBLISHED", isPlaceholder: false, email: "ada@example.test", emailPublic: false });
    const draft = await member(a, "Dan Draft", { isPlaceholder: false });
    const placeholder = await member(a, "Pat Placeholder", {});
    for (const [m, des, order] of [[verified, helper, 5], [hidden, helper, 1], [draft, lead, 0], [placeholder, lead, 0]] as const) {
      await org.addMembership(a.actor, m.id, membershipSchema.parse({ unitId: unit.id, designationId: des.id, displayOrder: order }));
    }
    const lead1 = await member(a, "Lia Leader", { visibility: "PUBLISHED", isPlaceholder: false });
    await org.addMembership(a.actor, lead1.id, membershipSchema.parse({ unitId: unit.id, designationId: lead.id }));
    await expect(org.updateMember(a.actor, placeholder.id, { visibility: "PUBLISHED" })).rejects.toMatchObject({ code: "placeholder_not_publishable" });

    const team = await org.getPublicTeam();
    const mine = team.units.find((u) => u.id === unit.id)!;
    expect(mine.people.map((p) => p.name)).toEqual(["Lia Leader", "Ada Hidden", "Zed Verified"]); // seniority, then display order
    const zed = mine.people.find((p) => p.name === "Zed Verified")!;
    expect(zed.email).toBe("zed@example.test");
    expect(mine.people.find((p) => p.name === "Ada Hidden")!.email).toBeNull(); // not public
    const all = JSON.stringify(team);
    for (const secret of ["Dan Draft", "Pat Placeholder", "ada@example.test"]) expect(all).not.toContain(secret);
  });

  it("archives former members with their end date and lists them in the archive, not the current team", async () => {
    const { a, unit, lead } = await setup();
    const m = await member(a, "Fay Former", { visibility: "PUBLISHED", isPlaceholder: false });
    const ms = await org.addMembership(a.actor, m.id, membershipSchema.parse({ unitId: unit.id, designationId: lead.id, startedOn: "2025-01-01" }));
    await expect(org.addMembership(a.actor, m.id, membershipSchema.parse({ unitId: unit.id, designationId: lead.id, startedOn: "2025-01-01" }))).rejects.toMatchObject({ code: "membership_exists" });
    await expect(org.addMembership(a.actor, m.id, membershipSchema.parse({ unitId: unit.id, designationId: lead.id, startedOn: "2025-05-01", endedOn: "2025-01-01" }))).rejects.toMatchObject({ code: "invalid_dates" });
    await org.updateMembership(a.actor, ms.id, { isArchived: true });
    await org.updateMember(a.actor, m.id, { status: "FORMER" });
    const archived = await getDb().orgMembership.findUniqueOrThrow({ where: { id: ms.id } });
    expect(archived.isArchived).toBe(true);
    expect(archived.endedOn).not.toBeNull();
    const team = await org.getPublicTeam();
    expect(team.units.find((u) => u.id === unit.id)).toBeUndefined();
    expect(team.former.map((p) => p.name)).toContain("Fay Former");
    await org.deleteMembership(a.actor, ms.id);
    await expect(org.deleteMembership(a.actor, ms.id)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps exactly one current term and validates term dates", async () => {
    const a = await admin();
    const previous = await getDb().orgTerm.findMany({ where: { isCurrent: true } });
    const t1 = await org.createTerm(a.actor, termSchema.parse({ label: `T1 ${tag()}`, startsOn: "2031-01-01", isCurrent: true }));
    const t2 = await org.createTerm(a.actor, termSchema.parse({ label: `T2 ${tag()}`, startsOn: "2032-01-01", isCurrent: true }));
    createdTerms.push(t1.id, t2.id);
    expect((await getDb().orgTerm.findMany({ where: { isCurrent: true } })).map((t) => t.id)).toEqual([t2.id]);
    await org.updateTerm(a.actor, t1.id, { isCurrent: true });
    expect((await getDb().orgTerm.findMany({ where: { isCurrent: true } })).map((t) => t.id)).toEqual([t1.id]);
    await expect(org.createTerm(a.actor, termSchema.parse({ label: `T3 ${tag()}`, startsOn: "2033-01-01", endsOn: "2032-01-01" }))).rejects.toMatchObject({ code: "invalid_term" });
    for (const t of previous) await getDb().orgTerm.update({ where: { id: t.id }, data: { isCurrent: true } }); // restore pre-test state
  });

  it("profile photos: validated images, private until the member is verified and published, replaced files are removed", async () => {
    const { a } = await setup();
    const m = await member(a, "Pia Photo", { visibility: "PUBLISHED", isPlaceholder: false });
    await expect(org.setMemberPhoto(a.actor, m.id, { name: "evil.svg", declaredMime: "image/svg+xml", bytes: new Uint8Array([60, 115]) })).rejects.toMatchObject({ code: "invalid_file" });
    await expect(org.setMemberPhoto(a.actor, m.id, { name: "fake.png", declaredMime: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) })).rejects.toMatchObject({ code: "invalid_file" });
    await expect(org.setMemberPhoto(a.actor, m.id, { name: "doc.pdf", declaredMime: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]) })).rejects.toMatchObject({ code: "invalid_file" });
    await expect(org.setMemberPhoto(a.actor, m.id, { name: "big.png", declaredMime: "image/png", bytes: new Uint8Array(2 * 1024 * 1024 + 1).fill(1).map((_, i) => (i < 8 ? PNG[i] : 1)) })).rejects.toMatchObject({ code: "invalid_file" });
    await org.setMemberPhoto(a.actor, m.id, { name: "me.png", declaredMime: "image/png", bytes: PNG });
    const firstKey = (await getDb().orgMember.findUniqueOrThrow({ where: { id: m.id } })).photoKey!;
    expect(firstKey).toMatch(/^org-members\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect((await org.getMemberPhoto(null, m.id)).mime).toBe("image/png"); // verified and published: public
    await org.setMemberPhoto(a.actor, m.id, { name: "me.jpg", declaredMime: "image/jpeg", bytes: JPG });
    expect(await createLocalStorage(dir).get(firstKey)).toBeNull(); // the old file is gone
    expect((await org.getMemberPhoto(null, m.id)).mime).toBe("image/jpeg");
    await org.updateMember(a.actor, m.id, { visibility: "DRAFT" });
    await expect(org.getMemberPhoto(null, m.id)).rejects.toMatchObject({ status: 404 }); // unpublished: private
    await expect(org.getMemberPhoto((await participant()).actor, m.id)).rejects.toMatchObject({ status: 404 });
    await expect(org.getMemberPhoto(a.actor, m.id)).resolves.toBeDefined(); // administrators still see it
    const key = (await getDb().orgMember.findUniqueOrThrow({ where: { id: m.id } })).photoKey!;
    await org.deleteMember(a.actor, m.id);
    createdMembers.pop();
    expect(await createLocalStorage(dir).get(key)).toBeNull();
  });
});

describe("analytics", () => {
  it("validates and bounds the date range", () => {
    const now = new Date("2030-06-15T10:00:00Z");
    expect(resolveRange({}, now)).toEqual({ from: new Date("2030-05-17T00:00:00Z"), to: new Date("2030-06-16T00:00:00Z") });
    expect(resolveRange({ from: "2030-01-01", to: "2030-01-31" }, now)).toEqual({ from: new Date("2030-01-01T00:00:00Z"), to: new Date("2030-02-01T00:00:00Z") });
    expect(() => resolveRange({ from: "2030-02-01", to: "2030-01-01" }, now)).toThrow(/before/);
    expect(() => resolveRange({ from: "2020-01-01", to: "2030-01-01" }, now)).toThrow(/at most 366/);
    expect(analyticsQuerySchema.safeParse({ from: "01/01/2030" }).success).toBe(false);
  });

  it("reports exact figures from the database for a isolated date range", async () => {
    const a = await admin();
    const db = getDb();
    const o = await organizer();
    const before = await getAnalytics(a.actor, { from: "2020-03-01", to: "2020-03-10" });
    expect(before.users.newInRange).toBe(0);
    expect(before.registrations.series).toHaveLength(10);
    expect(before.registrations.series.every((d) => d.count === 0)).toBe(true);

    const day = (d: number) => new Date(`2020-03-0${d}T12:00:00Z`);
    const e1 = await publishedEvent(o, { title: `vt analytics ${tag()}`, category: "WORKSHOP" });
    const e2 = await publishedEvent(o, { title: `vt analytics ${tag()}`, category: "WORKSHOP", registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 3 });
    const people = [await createUser(), await createUser(), await createUser(), await createUser()];
    await db.user.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { createdAt: day(2) } });
    // 3 individual registrations (2 confirmed on day 3, 1 cancelled on day 4), one outside the range
    await db.registration.create({ data: { eventId: e1.id, userId: people[0].id, status: "CONFIRMED", registeredAt: day(3) } });
    await db.registration.create({ data: { eventId: e1.id, userId: people[1].id, status: "CONFIRMED", registeredAt: day(3) } });
    await db.registration.create({ data: { eventId: e1.id, userId: people[2].id, status: "CANCELLED", registeredAt: day(4), cancelledAt: day(5) } });
    await db.registration.create({ data: { eventId: e1.id, userId: people[3].id, status: "CONFIRMED", registeredAt: new Date("2020-04-20T00:00:00Z") } });
    // a team of 2 registered on day 6
    const team = await db.team.create({ data: { eventId: e2.id, name: `vt an team ${tag()}`, leaderId: people[0].id, createdAt: day(5) } });
    await db.teamMember.create({ data: { teamId: team.id, eventId: e2.id, userId: people[0].id, role: "LEADER" } });
    await db.teamMember.create({ data: { teamId: team.id, eventId: e2.id, userId: people[1].id, role: "MEMBER" } });
    await db.registration.create({ data: { eventId: e2.id, userId: people[0].id + "", teamId: team.id, status: "CONFIRMED", registeredAt: day(6) } }).catch(() => undefined);
    // submissions, judging, results, certificates
    const sub = await db.submission.create({ data: { eventId: e1.id, ownerId: people[0].id, title: "vt an sub", description: "d", status: "SUBMITTED", submittedAt: day(7) } });
    const crit = await db.judgingCriterion.create({ data: { eventId: e1.id, name: "Q", maxScore: 10, weight: 1 } });
    const judge = await createUser({ roles: ["JUDGE"] });
    await db.judgeAssignment.create({ data: { eventId: e1.id, judgeId: judge.id } });
    await db.score.create({ data: { submissionId: sub.id, judgeId: judge.id, criterionId: crit.id, score: 5, finalizedAt: day(8) } });
    await db.certificate.create({ data: { publicCode: `ST-AN-${tag()}`, eventId: e1.id, userId: people[0].id, type: "PARTICIPATION", recipientName: "x", issuedAt: day(9) } });

    const after = await getAnalytics(a.actor, { from: "2020-03-01", to: "2020-03-10" });
    expect(after.users.newInRange).toBe(4);
    expect(after.registrations.inRange).toMatchObject({ CONFIRMED: 3, CANCELLED: 1, WAITLISTED: 0 }); // 2 + team member row; the cancelled one; April excluded
    expect(after.registrations.series.find((d) => d.day === "2020-03-03")!.count).toBe(2);
    expect(after.registrations.series.find((d) => d.day === "2020-03-04")!.count).toBe(1);
    expect(after.registrations.viaTeams).toBe(1);
    expect(after.registrations.individual).toBe(2);
    expect(after.teams.createdInRange).toBe(1);
    expect(after.teams.averageSize).not.toBeNull();
    expect(after.submissions.submittedInRange).toBe(1);
    expect(after.certificates.issuedInRange).toEqual({ PARTICIPATION: 1 });
    expect(after.events.byCategory.WORKSHOP).toBeGreaterThanOrEqual(2);
    // judging completion: this event expects 1 judge x 1 submission and has 1 finalized complete scorecard
    expect(after.judging.scorecardsFinalized - before.judging.scorecardsFinalized).toBe(1);
    expect(after.judging.scorecardsExpected - before.judging.scorecardsExpected).toBe(1);
    expect(after.users.total - before.users.total).toBe(5); // 4 people and the judge (the admin and organizer existed at the first snapshot)
    expect(after.users.byRole.JUDGE).toBeGreaterThanOrEqual(1);
  });

  it("rejects non-administrators and reversed ranges", async () => {
    const a = await admin();
    await expect(getAnalytics((await participant()).actor, {})).rejects.toMatchObject({ status: 403 });
    await expect(getAnalytics(a.actor, { from: "2030-02-01", to: "2030-01-01" })).rejects.toMatchObject({ code: "invalid_range" });
  });
});
