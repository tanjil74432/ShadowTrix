import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  can,
  hasGlobalRole,
  type Actor,
  type Permission,
  type Role,
} from "@/server/modules/authz/permissions";

const actor = (...roles: Actor["roles"][number][]): Actor => ({ id: "u1", roles });
const global = (role: Role) => ({ role });

/** The authoritative permission matrix. Any change to ROLE_PERMISSIONS must be reflected here deliberately. */
const MATRIX: Record<Role, Permission[]> = {
  PARTICIPANT: ["account:manage_own", "event:view", "event:register"],
  TEAM_LEADER: ["account:manage_own", "event:view", "event:register", "team:manage_own"],
  ORGANIZER: ["account:manage_own", "event:view", "event:register", "event:manage"],
  JUDGE: ["account:manage_own", "event:view", "event:register", "event:judge"],
  ADMIN: [...PERMISSIONS],
};

describe("RBAC permission matrix", () => {
  for (const role of Object.keys(MATRIX) as Role[]) {
    for (const permission of PERMISSIONS) {
      const expected = MATRIX[role].includes(permission);
      it(`${role} ${expected ? "can" : "cannot"} ${permission}`, () => {
        expect(can(actor(global(role)), permission)).toBe(expected);
      });
    }
  }

  it("only administrators reach admin and user-management permissions", () => {
    for (const role of ["PARTICIPANT", "TEAM_LEADER", "ORGANIZER", "JUDGE"] as Role[]) {
      for (const p of ["admin:access", "users:read", "users:manage"] as Permission[]) {
        expect(can(actor(global(role)), p), `${role} ${p}`).toBe(false);
      }
    }
  });

  it("denies everything to anonymous or role-less actors", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
      expect(can({ id: "x", roles: [] }, p)).toBe(false);
    }
  });

  it("denies unknown role strings (a tampered value grants nothing)", () => {
    const forged = { id: "x", roles: [{ role: "SUPERUSER" as unknown as Role }] };
    for (const p of PERMISSIONS) expect(can(forged, p)).toBe(false);
  });

  it("combines grants: a participant who is also a judge gets judge rights", () => {
    const a = actor(global("PARTICIPANT"), global("JUDGE"));
    expect(can(a, "event:judge")).toBe(true);
    expect(can(a, "event:manage")).toBe(false);
  });
});

describe("scoped grants", () => {
  const scoped = actor({ role: "ORGANIZER", eventId: "event-1" });

  it("apply only to the event they are granted for", () => {
    expect(can(scoped, "event:manage", { eventId: "event-1" })).toBe(true);
    expect(can(scoped, "event:manage", { eventId: "event-2" })).toBe(false);
  });

  it("never satisfy a request that names no event (no accidental global power)", () => {
    expect(can(scoped, "event:manage")).toBe(false);
    expect(can(scoped, "event:manage", {})).toBe(false);
  });

  it("a global grant covers every event", () => {
    const g = actor(global("ORGANIZER"));
    expect(can(g, "event:manage", { eventId: "anything" })).toBe(true);
    expect(can(g, "event:manage")).toBe(true);
  });

  it("organization-scoped grants are limited to that organization", () => {
    const o = actor({ role: "ORGANIZER", organizationId: "org-1" });
    expect(can(o, "event:manage", { organizationId: "org-1" })).toBe(true);
    expect(can(o, "event:manage", { organizationId: "org-2" })).toBe(false);
    expect(can(o, "event:manage")).toBe(false);
  });

  it("hasGlobalRole ignores scoped grants", () => {
    expect(hasGlobalRole(scoped, "ORGANIZER")).toBe(false);
    expect(hasGlobalRole(actor(global("ADMIN")), "ADMIN")).toBe(true);
    expect(hasGlobalRole(null, "ADMIN")).toBe(false);
  });
});

describe("role assignment rules", () => {
  it("TEAM_LEADER is derived from team membership and cannot be handed out", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("TEAM_LEADER");
    expect(ASSIGNABLE_ROLES).toEqual(expect.arrayContaining(["PARTICIPANT", "ORGANIZER", "JUDGE", "ADMIN"]));
  });
});
