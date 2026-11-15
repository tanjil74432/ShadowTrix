import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { grantRole, listUsers, revokeRole, setUserStatus } from "@/server/modules/admin/admin-users.service";
import { createSession, getSessionUser } from "@/server/modules/auth/session.service";
import { actorOf, cleanup, createUser } from "./helpers/auth-harness";

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

const adminUser = () => createUser({ roles: ["PARTICIPANT", "ADMIN"] });
const activeAdminCount = (ids: string[]) =>
  getDb().userRoleAssignment.count({
    where: { userId: { in: ids }, role: "ADMIN", eventId: null, organizationId: null, user: { status: "ACTIVE" } },
  });

describe("admin authorization is enforced in the service, for every caller", () => {
  it.each(["PARTICIPANT", "ORGANIZER", "JUDGE"] as const)("a %s cannot list, grant, revoke or suspend", async (role) => {
    const actor = actorOf(await createUser({ roles: role === "PARTICIPANT" ? ["PARTICIPANT"] : ["PARTICIPANT", role] }));
    const target = await createUser();
    await expect(listUsers(actor, { page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 });
    await expect(grantRole(actor, target.id, "ORGANIZER")).rejects.toMatchObject({ status: 403 });
    await expect(revokeRole(actor, target.id, "ORGANIZER")).rejects.toMatchObject({ status: 403 });
    await expect(setUserStatus(actor, target.id, "SUSPENDED")).rejects.toMatchObject({ status: 403 });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("ACTIVE");
  });

  it("an event-scoped admin grant does not confer platform administration", async () => {
    const u = await createUser();
    await getDb().userRoleAssignment.create({ data: { userId: u.id, role: "ADMIN", eventId: (await makeEvent()).id } });
    const actor = actorOf(await getDb().user.findUniqueOrThrow({ where: { id: u.id }, include: { roles: true } }));
    await expect(listUsers(actor, { page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 });
  });

  async function makeEvent() {
    const t = (h: number) => new Date(Date.UTC(2031, 0, 1) + h * 3_600_000);
    return getDb().event.create({
      data: {
        slug: `vt-${Math.random().toString(36).slice(2)}`, title: "T", category: "OTHER", summary: "s", description: "d",
        startsAt: t(100), endsAt: t(120), registrationOpensAt: t(0), registrationClosesAt: t(90),
      },
    });
  }
});

describe("role management", () => {
  it("grants and revokes roles, idempotently, with an audit trail", async () => {
    const admin = await adminUser();
    const target = await createUser();
    const actor = actorOf(admin);

    const granted = await grantRole(actor, target.id, "ORGANIZER");
    expect(granted.roles.map((r) => r.role).sort()).toEqual(["ORGANIZER", "PARTICIPANT"]);
    await grantRole(actor, target.id, "ORGANIZER"); // repeat: no duplicate, no error
    expect(await getDb().userRoleAssignment.count({ where: { userId: target.id, role: "ORGANIZER" } })).toBe(1);

    const revoked = await revokeRole(actor, target.id, "ORGANIZER");
    expect(revoked.roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);
    const actions = (await getDb().auditLog.findMany({ where: { actorId: admin.id, entityId: target.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.role_granted", "admin.role_revoked"]));
  });

  it("takes effect on the very next request of the affected user (no stale role in a session)", async () => {
    const admin = await adminUser();
    const target = await createUser();
    const { token } = await createSession(target.id);
    expect((await getSessionUser(token))!.user.roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);
    await grantRole(actorOf(admin), target.id, "JUDGE");
    expect((await getSessionUser(token))!.user.roles.map((r) => r.role)).toContain("JUDGE");
    await revokeRole(actorOf(admin), target.id, "JUDGE");
    expect((await getSessionUser(token))!.user.roles.map((r) => r.role)).not.toContain("JUDGE");
  });

  it("refuses team leader (derived), the base participant removal, unknown users and self-demotion", async () => {
    const admin = await adminUser();
    const actor = actorOf(admin);
    const target = await createUser();
    await expect(grantRole(actor, target.id, "TEAM_LEADER")).rejects.toMatchObject({ code: "role_not_assignable" });
    await expect(revokeRole(actor, target.id, "PARTICIPANT")).rejects.toMatchObject({ code: "base_role" });
    await expect(revokeRole(actor, admin.id, "ADMIN")).rejects.toMatchObject({ status: 409, code: "cannot_demote_self" });
    await expect(grantRole(actor, "00000000-0000-7000-8000-000000000000", "JUDGE")).rejects.toMatchObject({ status: 404 });
    expect(await activeAdminCount([admin.id])).toBe(1);
  });

  it("two administrators demoting each other at the same instant can never leave zero admins", async () => {
    const a = await adminUser();
    const b = await adminUser();
    const [ra, rb] = await Promise.allSettled([
      revokeRole(actorOf(a), b.id, "ADMIN"),
      revokeRole(actorOf(b), a.id, "ADMIN"),
    ]);
    expect([ra.status, rb.status].filter((s) => s === "fulfilled")).toHaveLength(1);
    const loser = [ra, rb].find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ status: 403 }); // the demoted actor lost their authority inside the lock
    expect(await activeAdminCount([a.id, b.id])).toBe(1);
  });

  it("a demoted administrator can no longer perform admin actions", async () => {
    const a = await adminUser();
    const b = await adminUser();
    await revokeRole(actorOf(a), b.id, "ADMIN");
    // b still holds a stale in-memory actor object; the transaction re-checks the database
    await expect(grantRole(actorOf(b), a.id, "JUDGE")).rejects.toMatchObject({ status: 403 });
  });
});

describe("suspension", () => {
  it("revokes every session immediately, blocks lookup, and is reversible", async () => {
    const admin = await adminUser();
    const target = await createUser();
    const { token } = await createSession(target.id);
    const view = await setUserStatus(actorOf(admin), target.id, "SUSPENDED");
    expect(view.status).toBe("SUSPENDED");
    expect(await getSessionUser(token)).toBeNull();
    expect((await getDb().session.findFirstOrThrow({ where: { userId: target.id } })).revokedReason).toBe("suspended");

    await setUserStatus(actorOf(admin), target.id, "ACTIVE");
    expect(await getSessionUser(token)).toBeNull(); // the old session stays dead; the user must log in again
  });

  it("an administrator cannot suspend themselves", async () => {
    const admin = await adminUser();
    await expect(setUserStatus(actorOf(admin), admin.id, "SUSPENDED")).rejects.toMatchObject({ status: 409, code: "cannot_suspend_self" });
  });

  it("a suspended administrator no longer counts toward the minimum and cannot act", async () => {
    const a = await adminUser();
    const b = await adminUser();
    await setUserStatus(actorOf(a), b.id, "SUSPENDED");
    await expect(grantRole(actorOf(b), a.id, "JUDGE")).rejects.toMatchObject({ status: 403 });
    expect(await activeAdminCount([a.id, b.id])).toBe(1);
  });
});

describe("listing", () => {
  it("never exposes password hashes or token data, and caps the page size", async () => {
    const admin = await adminUser();
    await Promise.all(Array.from({ length: 3 }, () => createUser()));
    const page = await listUsers(actorOf(admin), { page: 1, pageSize: 1000 });
    expect(page.pageSize).toBe(100);
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/passwordHash|password_hash|argon2|tokenHash/i);
    expect(Object.keys(page.items[0]).sort()).toEqual(["createdAt", "email", "emailVerified", "fullName", "id", "lastLoginAt", "roles", "status"]);
  });

  it("filters by search text and paginates", async () => {
    const admin = await adminUser();
    const marker = `vt-find-${Math.random().toString(36).slice(2, 8)}`;
    await createUser({ email: `${marker}@example.test` });
    const found = await listUsers(actorOf(admin), { page: 1, pageSize: 10, q: marker });
    expect(found.total).toBe(1);
    expect(found.items[0].email).toContain(marker);
    const empty = await listUsers(actorOf(admin), { page: 5, pageSize: 10, q: marker });
    expect(empty.items).toHaveLength(0);
  });
});
