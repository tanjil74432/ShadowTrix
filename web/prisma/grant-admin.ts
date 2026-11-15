/**
 * Bootstraps the first administrator.
 *
 * The admin API requires an existing administrator, and the platform ships with no default credentials,
 * so the first one must be promoted from the server side by someone with database access:
 *
 *   1. Register and confirm the account through the normal website flow.
 *   2. Run:  npm run admin:grant -- person@example.com
 *
 * Only an existing, active, email-verified account can be promoted. The action is written to the audit log.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

export type GrantResult = { ok: true; alreadyAdmin: boolean; userId: string } | { ok: false; reason: string };

export async function grantAdmin(db: PrismaClient, rawEmail: string): Promise<GrantResult> {
  const email = rawEmail.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return { ok: false, reason: "No account with that email address. Register through the website first." };
  if (!user.emailVerifiedAt) return { ok: false, reason: "That account has not confirmed its email address yet." };
  if (user.status !== "ACTIVE") return { ok: false, reason: "That account is suspended." };

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shadowtrix:admin-role-changes'))`;
    const existing = await tx.userRoleAssignment.findFirst({
      where: { userId: user.id, role: "ADMIN", eventId: null, organizationId: null },
    });
    if (existing) return { ok: true as const, alreadyAdmin: true, userId: user.id };
    await tx.userRoleAssignment.create({ data: { userId: user.id, role: "ADMIN" } });
    await tx.auditLog.create({
      data: { actorId: null, action: "admin.bootstrap_grant", entityType: "user", entityId: user.id, after: { role: "ADMIN", via: "cli" } },
    });
    return { ok: true as const, alreadyAdmin: false, userId: user.id };
  });
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run admin:grant -- <email>");
    process.exitCode = 2;
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await grantAdmin(db, email);
    if (!result.ok) {
      console.error(`Not granted: ${result.reason}`);
      process.exitCode = 1;
    } else {
      console.log(result.alreadyAdmin ? "That account is already an administrator." : "Administrator role granted.");
    }
  } finally {
    await db.$disconnect();
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /grant-admin\.(ts|js)$/.test(process.argv[1])) void main();
