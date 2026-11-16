import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import type { AuthDeps } from "@/server/modules/auth/auth.service";
import { hashPassword } from "@/server/modules/auth/password";
import type { Mail } from "@/server/modules/email/mailer";
import type { Actor } from "@/server/modules/authz/permissions";
import { purgeExpiredRateLimits } from "@/server/security/rate-limit";

/** Certificates keep their event and user (ON DELETE RESTRICT), so test cleanup removes them before the events. */
async function removeEventDependants(db: { certificate: { deleteMany: (args: { where: { eventId: { in: string[] } } }) => Promise<unknown> } }, eventIds: string[]) {
  await db.certificate.deleteMany({ where: { eventId: { in: eventIds } } });
}

export const PW = "correct horse battery staple";
export const NEW_PW = "a completely different passphrase";
export const ctx = { ip: null, userAgent: "vitest" } as const;

/** Mutable clock + captured mail, so tests control time and can read emails without SMTP. */
export function makeHarness() {
  let t = Date.now();
  const mails: Mail[] = [];
  const pending: Promise<void>[] = [];
  const deps: AuthDeps = {
    now: () => new Date(t),
    mailer: { send: async (m) => void mails.push(m) },
    schedule: (task) => void pending.push(task()),
  };
  return {
    deps,
    mails,
    advance: (ms: number) => void (t += ms),
    now: () => new Date(t),
    flush: async () => void (await Promise.all(pending.splice(0))),
    mailsTo: (email: string) => mails.filter((m) => m.to === email),
    lastMailTo: (email: string) => mails.filter((m) => m.to === email).at(-1),
  };
}

export const tokenFrom = (mail: Mail | undefined): string => {
  const m = mail?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("no token link in mail");
  return m[1];
};

const created: string[] = [];
export const uniqueEmail = (tag = "u") => `vt-${tag}-${randomUUID().slice(0, 8)}@example.test`;

export async function createUser(opts: {
  email?: string;
  verified?: boolean;
  status?: "ACTIVE" | "SUSPENDED";
  password?: string;
  roles?: ("PARTICIPANT" | "ORGANIZER" | "JUDGE" | "ADMIN")[];
  passwordHash?: string;
} = {}) {
  const email = opts.email ?? uniqueEmail();
  const user = await getDb().user.create({
    data: {
      email,
      fullName: "Test Person",
      passwordHash: opts.passwordHash ?? (await hashPassword(opts.password ?? PW)),
      status: opts.status ?? "ACTIVE",
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      roles: { create: (opts.roles ?? ["PARTICIPANT"]).map((role) => ({ role })) },
    },
    include: { roles: true },
  });
  created.push(user.id);
  return user;
}

export const actorOf = (u: { id: string; roles: { role: Actor["roles"][number]["role"]; eventId?: string | null; organizationId?: string | null }[] }): Actor => ({
  id: u.id,
  roles: u.roles.map((r) => ({ role: r.role, eventId: r.eventId ?? null, organizationId: r.organizationId ?? null })),
});

/**
 * Remove everything the tests created: users (cascading to sessions, tokens and roles), their audit rows and the
 * rate-limit counters. Audit rows are deleted first, while they can still be found through their user ids.
 */
export async function cleanup() {
  const db = getDb();
  const mine = created.splice(0);
  const doomed = await db.user.findMany({
    where: { OR: [{ id: { in: mine } }, { email: { startsWith: "vt-" } }] },
    select: { id: true },
  });
  const ids = doomed.map((u) => u.id);
  // Events the test users created go first (their registrations and organizer rows cascade), with their audit rows.
  // (also any leftover from an interrupted run: test events carry the reserved vt- slug prefix)
  const eventIds = (await db.event.findMany({ where: { OR: [{ createdById: { in: ids } }, { slug: { startsWith: "vt-" } }] }, select: { id: true } })).map((e) => e.id);
  if (eventIds.length) {
    await removeEventDependants(db, eventIds);
    await db.auditLog.deleteMany({ where: { entityId: { in: eventIds } } });
    await db.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  // Only counters from windows that ended a while ago: test files run in parallel, and wiping every counter would
  // reset the rate-limit state of a test that is still running in another file.
  await purgeExpiredRateLimits(300);
}
