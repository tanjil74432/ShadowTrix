import "server-only";
import type { Prisma, RoleKey } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, forbidden, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { revokeAllUserSessions } from "@/server/modules/auth/session.service";
import { ASSIGNABLE_ROLES, can, type Actor } from "@/server/modules/authz/permissions";

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "SUSPENDED";
  emailVerified: boolean;
  roles: { role: RoleKey; eventId: string | null; organizationId: string | null }[];
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** Explicit allow-list mapping: the password hash and token data can never appear in a response. */
function toView(u: Prisma.UserGetPayload<{ include: { roles: true } }>): AdminUserView {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    status: u.status,
    emailVerified: !!u.emailVerifiedAt,
    roles: u.roles.map((r) => ({ role: r.role, eventId: r.eventId, organizationId: r.organizationId })),
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

/** The authorization check lives in the service, so it applies to every caller (API, page, script). */
function assertCanManage(actor: Actor) {
  if (!can(actor, "users:manage")) throw forbidden();
}

export async function listUsers(actor: Actor, opts: { page: number; pageSize: number; q?: string }) {
  if (!can(actor, "users:read")) throw forbidden();
  const pageSize = Math.min(Math.max(opts.pageSize, 1), 100);
  const page = Math.max(opts.page, 1);
  const q = opts.q?.trim();
  const where: Prisma.UserWhereInput = q
    ? { OR: [{ email: { contains: q.toLowerCase() } }, { fullName: { contains: q, mode: "insensitive" } }] }
    : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, include: { roles: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(toView), total, page, pageSize };
}

/** Serializes every change that could affect "who can administer the platform" (see lockAdminChanges). */
async function lockAdminChanges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shadowtrix:admin-role-changes'))`;
}

/** Inside the lock: the acting admin must still be an active admin (a concurrent change may have removed them). */
async function assertActorStillAdmin(tx: Prisma.TransactionClient, actorId: string) {
  const stillAdmin = await tx.userRoleAssignment.count({
    where: { userId: actorId, role: "ADMIN", eventId: null, organizationId: null, user: { status: "ACTIVE" } },
  });
  if (stillAdmin === 0) throw forbidden();
}

function assertAssignable(role: RoleKey) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new AppError(400, "role_not_assignable", "This role cannot be assigned directly.");
  }
}

export async function grantRole(actor: Actor, targetId: string, role: RoleKey): Promise<AdminUserView> {
  assertCanManage(actor);
  assertAssignable(role);
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lockAdminChanges(tx);
    await assertActorStillAdmin(tx, actor.id);
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target) throw notFound("User");
    const existing = await tx.userRoleAssignment.findFirst({ where: { userId: targetId, role, eventId: null, organizationId: null } });
    if (!existing) {
      await tx.userRoleAssignment.create({ data: { userId: targetId, role, grantedById: actor.id } });
      await writeAudit({ actorId: actor.id, action: "admin.role_granted", entityType: "user", entityId: targetId, after: { role } }, tx);
      // A privilege change ends the target's existing sessions, so they sign in again and get a fresh token.
      if (targetId !== actor.id) await revokeAllUserSessions(targetId, "role_changed", tx);
    }
    return toView(await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: { roles: true } }));
  });
}

export async function revokeRole(actor: Actor, targetId: string, role: RoleKey): Promise<AdminUserView> {
  assertCanManage(actor);
  assertAssignable(role);
  if (role === "PARTICIPANT") throw new AppError(400, "base_role", "The participant role is the base role and cannot be removed.");
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lockAdminChanges(tx);
    await assertActorStillAdmin(tx, actor.id);
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target) throw notFound("User");
    if (role === "ADMIN") {
      if (targetId === actor.id) throw new AppError(409, "cannot_demote_self", "You cannot remove your own administrator role.");
      const otherAdmins = await tx.userRoleAssignment.count({
        where: { role: "ADMIN", eventId: null, organizationId: null, userId: { not: targetId }, user: { status: "ACTIVE" } },
      });
      if (otherAdmins === 0) throw new AppError(409, "last_admin", "At least one active administrator must remain.");
    }
    const removed = await tx.userRoleAssignment.deleteMany({ where: { userId: targetId, role, eventId: null, organizationId: null } });
    if (removed.count > 0) {
      await writeAudit({ actorId: actor.id, action: "admin.role_revoked", entityType: "user", entityId: targetId, before: { role } }, tx);
      if (targetId !== actor.id) await revokeAllUserSessions(targetId, "role_changed", tx);
    }
    return toView(await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: { roles: true } }));
  });
}

export async function setUserStatus(actor: Actor, targetId: string, status: "ACTIVE" | "SUSPENDED"): Promise<AdminUserView> {
  assertCanManage(actor);
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lockAdminChanges(tx);
    await assertActorStillAdmin(tx, actor.id);
    const target = await tx.user.findUnique({ where: { id: targetId }, include: { roles: true } });
    if (!target) throw notFound("User");
    if (status === "SUSPENDED") {
      if (targetId === actor.id) throw new AppError(409, "cannot_suspend_self", "You cannot suspend your own account.");
      const isAdmin = target.roles.some((r) => r.role === "ADMIN" && !r.eventId && !r.organizationId);
      if (isAdmin) {
        const otherAdmins = await tx.userRoleAssignment.count({
          where: { role: "ADMIN", eventId: null, organizationId: null, userId: { not: targetId }, user: { status: "ACTIVE" } },
        });
        if (otherAdmins === 0) throw new AppError(409, "last_admin", "At least one active administrator must remain.");
      }
    }
    if (target.status !== status) {
      await tx.user.update({ where: { id: targetId }, data: { status } });
      // Suspension takes effect immediately: every session is revoked (and sessions of suspended users never validate).
      if (status === "SUSPENDED") await revokeAllUserSessions(targetId, "suspended", tx);
      await writeAudit({ actorId: actor.id, action: "admin.user_status_changed", entityType: "user", entityId: targetId, before: { status: target.status }, after: { status } }, tx);
    }
    return toView(await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: { roles: true } }));
  });
}
