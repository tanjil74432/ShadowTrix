import { afterAll, afterEach, describe, expect, it } from "vitest";
import { canonicalUniversity, QUICK_UNIVERSITIES } from "@/lib/leadership/universities";
import { getDb } from "@/server/db/client";
import { memberSchema, memberUpdateSchema } from "@/server/modules/organization/organization.schema";
import * as org from "@/server/modules/organization/organization.service";
import { actorOf, cleanup, createUser } from "./helpers/auth-harness";

/** A board member's university: optional, normalised, administrator-only to change, shown publicly, and harmless for members that have none. */
const members: string[] = [];
const units: string[] = [];
const designations: string[] = [];
afterEach(async () => {
  const db = getDb();
  await db.orgMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  await db.orgUnit.deleteMany({ where: { id: { in: units.splice(0) } } });
  await db.designation.deleteMany({ where: { id: { in: designations.splice(0) } } });
  await db.auditLog.deleteMany({ where: { action: { in: ["admin.org_member_created", "admin.org_member_updated"] } } });
  await cleanup();
});
afterAll(async () => { await getDb().$disconnect(); });

const admin = async () => actorOf(await createUser({ roles: ["ADMIN"] }));
const tag = () => Math.random().toString(36).slice(2, 8);
const create = async (a: Awaited<ReturnType<typeof admin>>, input: Record<string, unknown>) => {
  const m = await org.createMember(a, memberSchema.parse({ fullName: `Uni Member ${tag()}`, ...input }));
  members.push(m.id);
  return m;
};
/** Publishes a member on a fresh active unit so the public team shows them. */
async function publish(id: string) {
  const db = getDb(), t = tag();
  const unit = await db.orgUnit.create({ data: { slug: `uni-${t}`, name: `Uni Unit ${t}`, isActive: true } });
  units.push(unit.id);
  const des = await db.designation.create({ data: { title: `Uni Designation ${t}`, rankOrder: 1 } });
  designations.push(des.id);
  await db.orgMembership.create({ data: { memberId: id, unitId: unit.id, designationId: des.id } });
  await db.orgMember.update({ where: { id }, data: { visibility: "PUBLISHED", isPlaceholder: false } });
}
const inPublicTeam = async (id: string) => {
  const team = await org.getPublicTeam();
  return [...team.units.flatMap((u) => u.people), ...team.former].find((p) => p.id === id);
};

describe("the university value", () => {
  it("is optional: omitted, empty or null all mean 'none', so existing forms and API callers keep working", () => {
    expect(memberSchema.parse({ fullName: "No University" }).university).toBeUndefined();
    expect(memberSchema.parse({ fullName: "No University", university: "" }).university).toBeNull();
    expect(memberSchema.parse({ fullName: "No University", university: null }).university).toBeNull();
    expect(memberUpdateSchema.parse({}).university).toBeUndefined(); // an update that does not mention it leaves it alone
    expect(memberUpdateSchema.parse({ university: "   " }).university).toBeNull();
  });

  it("is normalised to one spelling: spaces are tidied and the quick choice is stored as written in the list, any other name is kept as typed", () => {
    expect(QUICK_UNIVERSITIES).toContain("Eastern University");
    expect(canonicalUniversity("  eastern   UNIVERSITY ")).toBe("Eastern University");
    expect(memberSchema.parse({ fullName: "A B", university: "EASTERN university" }).university).toBe("Eastern University");
    expect(memberSchema.parse({ fullName: "A B", university: "  University   of Dhaka " }).university).toBe("University of Dhaka");
    expect(memberSchema.parse({ fullName: "A B", university: "Jahangirnagar University (JU)" }).university).toBe("Jahangirnagar University (JU)");
  });

  it("is bounded and safe: at most 150 characters, no control characters or angle brackets", () => {
    expect(memberSchema.safeParse({ fullName: "A B", university: "x".repeat(150) }).success).toBe(true);
    for (const bad of ["x".repeat(151), "Bad\u0000Name", "Bad\u0007Name", "<script>alert(1)</script>", "Uni <b>"]) {
      expect(memberSchema.safeParse({ fullName: "A B", university: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(memberSchema.safeParse({ fullName: "A B", university: 5 }).success).toBe(false);
  });
});

describe("saving and reading a member's university", () => {
  it("creates with a university, a custom university or none; the department stays separate", async () => {
    const a = await admin();
    const eastern = await create(a, { department: "CSE", university: "eastern university" });
    expect([eastern.department, eastern.university]).toEqual(["CSE", "Eastern University"]);
    const custom = await create(a, { university: "North South University" });
    expect([custom.department, custom.university]).toEqual([null, "North South University"]);
    const none = await create(a, { department: "EEE" });
    expect(none.university).toBeNull();
    expect((await org.getMember(a, eastern.id)).university).toBe("Eastern University"); // the admin editor reads it back
  });

  it("updates it, changes it, clears it, and leaves it alone when an update does not mention it; every change is audited", async () => {
    const a = await admin();
    const m = await create(a, { department: "CSE" });
    await org.updateMember(a, m.id, memberUpdateSchema.parse({ university: "Eastern University" }));
    expect((await org.getMember(a, m.id)).university).toBe("Eastern University");
    await org.updateMember(a, m.id, memberUpdateSchema.parse({ bio: "Changed the bio only" }));
    expect((await org.getMember(a, m.id)).university, "an update without the field keeps it").toBe("Eastern University");
    await org.updateMember(a, m.id, memberUpdateSchema.parse({ university: "Dhaka University" }));
    expect((await org.getMember(a, m.id)).university).toBe("Dhaka University");
    await org.updateMember(a, m.id, memberUpdateSchema.parse({ university: "" }));
    expect((await org.getMember(a, m.id)).university, "an empty value clears it").toBeNull();
    expect((await org.getMember(a, m.id)).department, "the department is untouched throughout").toBe("CSE");
    const audits = await getDb().auditLog.findMany({ where: { actorId: a.id, action: "admin.org_member_updated", entityId: m.id } });
    expect(audits.length).toBe(4);
    expect(audits.some((x) => JSON.stringify(x.after).includes("university"))).toBe(true);
  });

  it("is administrator-only: everyone else is refused and nothing is written", async () => {
    const a = await admin();
    const m = await create(a, { university: "Eastern University" });
    const outsiders = [actorOf(await createUser()), actorOf(await createUser({ roles: ["ORGANIZER"] })), actorOf(await createUser({ roles: ["JUDGE"] }))];
    for (const who of outsiders) {
      await expect(org.createMember(who, memberSchema.parse({ fullName: "Nope Person", university: "X University" }))).rejects.toMatchObject({ status: 403 });
      await expect(org.updateMember(who, m.id, memberUpdateSchema.parse({ university: "Changed" }))).rejects.toMatchObject({ status: 403 });
      await expect(org.listUniversitySuggestions(who)).rejects.toMatchObject({ status: 403 });
    }
    expect((await org.getMember(a, m.id)).university).toBe("Eastern University");
  });

  it("suggests the quick choice first, then every university already in use, once each", async () => {
    const a = await admin();
    await create(a, { university: "Zeta Test University" });
    await create(a, { university: "Zeta Test University" });
    await create(a, { university: "Alpha Test University" });
    const list = await org.listUniversitySuggestions(a);
    expect(list[0]).toBe("Eastern University");
    expect(list.filter((u) => u === "Zeta Test University")).toHaveLength(1);
    expect(list).toContain("Alpha Test University");
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("existing members and the public team", () => {
  it("members created before the field existed (no value in the database) still read, update and publish normally", async () => {
    const db = getDb(), a = await admin();
    const old = await db.orgMember.create({ data: { slug: `old-${tag()}`, fullName: "Old Member", department: "CSE", visibility: "DRAFT", isPlaceholder: true } }); // as a row from before the column existed
    members.push(old.id);
    expect(old.university).toBeNull();
    expect((await org.getMember(a, old.id)).university).toBeNull();
    await org.updateMember(a, old.id, memberUpdateSchema.parse({ bio: "Still editable" }));
    await publish(old.id);
    const pub = await inPublicTeam(old.id);
    expect(pub).toBeTruthy();
    expect([pub!.department, pub!.university]).toEqual(["CSE", null]);
  });

  it("the public team carries the university of published members, and drafts and placeholders stay hidden", async () => {
    const a = await admin();
    const shown = await create(a, { department: "CSE", university: "Eastern University" });
    await publish(shown.id);
    const hidden = await create(a, { university: "Secret Draft University" });
    const pub = await inPublicTeam(shown.id);
    expect([pub?.department, pub?.university]).toEqual(["CSE", "Eastern University"]);
    expect(await inPublicTeam(hidden.id), "a draft is not public").toBeUndefined();
    expect(JSON.stringify(await org.getPublicTeam())).not.toContain("Secret Draft University");
  });
});
