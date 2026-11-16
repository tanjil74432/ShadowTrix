import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { getBannerMember, getOwnBannerSubject, listBannerMembers } from "@/server/modules/organization/banner.service";
import { actorOf, cleanup, createUser } from "./helpers/auth-harness";

const tag = () => randomUUID().slice(0, 8);
const units: string[] = [];
const designations: string[] = [];
const members: string[] = [];
afterEach(async () => {
  const db = getDb();
  await db.orgMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  await db.orgUnit.deleteMany({ where: { id: { in: units.splice(0) } } });
  await db.designation.deleteMany({ where: { id: { in: designations.splice(0) } } });
  await cleanup();
});

async function member(opts: { userId?: string; placeholder?: boolean; status?: "ACTIVE" | "FORMER"; positions?: { title: string; archived?: boolean }[] }) {
  const db = getDb();
  const t = tag();
  const unit = await db.orgUnit.create({ data: { slug: `vt-${t}`, name: `VT Unit ${t}` } });
  units.push(unit.id);
  const m = await db.orgMember.create({
    data: { slug: `vt-${t}`, fullName: `VT Member ${t}`, isPlaceholder: opts.placeholder ?? false, status: opts.status ?? "ACTIVE", userId: opts.userId },
  });
  members.push(m.id);
  for (const p of opts.positions ?? []) {
    const d = await db.designation.create({ data: { title: `${p.title} ${t}`, rankOrder: 1 } });
    designations.push(d.id);
    await db.orgMembership.create({ data: { memberId: m.id, unitId: unit.id, designationId: d.id, isArchived: p.archived ?? false } });
  }
  return m;
}

describe("banner creator data: designations come only from approved positions", () => {
  it("offers a verified active member's current positions", async () => {
    const u = await createUser();
    await member({ userId: u.id, positions: [{ title: "President" }] });
    const s = await getOwnBannerSubject({ id: u.id, fullName: u.fullName });
    expect(s.designations.map((d) => d.label)).toHaveLength(1);
    expect(s.designations[0].label).toMatch(/^President /);
  });

  it("offers nothing to an ordinary user without an organization profile", async () => {
    const u = await createUser();
    const s = await getOwnBannerSubject({ id: u.id, fullName: u.fullName });
    expect(s.designations).toEqual([]);
    expect(s.memberId).toBeNull();
    expect(s.fullName).toBe(u.fullName);
  });

  it("offers nothing for placeholder profiles, former members, or archived positions", async () => {
    const a = await createUser(), b = await createUser(), c = await createUser();
    await member({ userId: a.id, placeholder: true, positions: [{ title: "Founder" }] });
    await member({ userId: b.id, status: "FORMER", positions: [{ title: "CTO" }] });
    await member({ userId: c.id, positions: [{ title: "Treasurer", archived: true }] });
    for (const u of [a, b, c]) expect((await getOwnBannerSubject({ id: u.id, fullName: u.fullName })).designations).toEqual([]);
  });

  it("is admin-only for other people, and never lists placeholders", async () => {
    const admin = actorOf(await createUser({ roles: ["ADMIN"] }));
    const plain = actorOf(await createUser());
    const real = await member({ positions: [{ title: "Secretary" }] });
    const ph = await member({ placeholder: true, positions: [{ title: "Founder" }] });
    await expect(listBannerMembers(plain)).rejects.toMatchObject({ status: 403 });
    await expect(getBannerMember(plain, real.id)).rejects.toMatchObject({ status: 403 });
    const ids = (await listBannerMembers(admin)).map((m) => m.id);
    expect(ids).toContain(real.id);
    expect(ids).not.toContain(ph.id);
    expect((await getBannerMember(admin, real.id)).designations).toHaveLength(1);
    await expect(getBannerMember(admin, ph.id)).rejects.toMatchObject({ status: 404 });
  });
});
