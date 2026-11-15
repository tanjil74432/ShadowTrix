import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { grantAdmin } from "../prisma/grant-admin";
import { cleanup, createUser, uniqueEmail } from "./helpers/auth-harness";

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

describe("first-administrator bootstrap", () => {
  it("promotes a verified, active account, once, and records an audit entry", async () => {
    const u = await createUser();
    const first = await grantAdmin(getDb(), ` ${u.email.toUpperCase()} `);
    expect(first).toEqual({ ok: true, alreadyAdmin: false, userId: u.id });
    expect(await getDb().userRoleAssignment.count({ where: { userId: u.id, role: "ADMIN" } })).toBe(1);
    expect(await getDb().auditLog.count({ where: { entityId: u.id, action: "admin.bootstrap_grant" } })).toBe(1);

    const again = await grantAdmin(getDb(), u.email);
    expect(again).toMatchObject({ ok: true, alreadyAdmin: true });
    expect(await getDb().userRoleAssignment.count({ where: { userId: u.id, role: "ADMIN" } })).toBe(1);
  });

  it("refuses unknown, unconfirmed and suspended accounts", async () => {
    const unverified = await createUser({ verified: false });
    const suspended = await createUser({ status: "SUSPENDED" });
    expect(await grantAdmin(getDb(), uniqueEmail("nobody"))).toMatchObject({ ok: false });
    expect(await grantAdmin(getDb(), unverified.email)).toMatchObject({ ok: false, reason: expect.stringMatching(/confirmed/) });
    expect(await grantAdmin(getDb(), suspended.email)).toMatchObject({ ok: false, reason: expect.stringMatching(/suspended/) });
    expect(await getDb().userRoleAssignment.count({ where: { userId: { in: [unverified.id, suspended.id] }, role: "ADMIN" } })).toBe(0);
  });

  it("is safe under concurrent runs (one grant, no duplicate)", async () => {
    const u = await createUser();
    await Promise.all([grantAdmin(getDb(), u.email), grantAdmin(getDb(), u.email), grantAdmin(getDb(), u.email)]);
    expect(await getDb().userRoleAssignment.count({ where: { userId: u.id, role: "ADMIN" } })).toBe(1);
  });
});
