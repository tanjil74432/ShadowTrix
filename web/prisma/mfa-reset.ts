/**
 * Break-glass for an administrator who lost both their authenticator and their recovery codes:
 *   npm run admin:mfa-reset -- <email>
 * Run by someone with database access. It turns two-step verification OFF for that account (it does not grant or remove
 * any role, and the account still needs its password) and writes an audit entry.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run admin:mfa-reset -- <email>");
    process.exitCode = 2;
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error("No account with that email address.");
      process.exitCode = 1;
      return;
    }
    await db.$transaction([
      db.userMfa.deleteMany({ where: { userId: user.id } }),
      db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "mfa_reset" } }),
      db.auditLog.create({ data: { actorId: null, action: "mfa.reset_cli", entityType: "user", entityId: user.id } }),
    ]);
    console.log("Two-step verification was turned off for that account and its sessions were revoked.");
  } finally {
    await db.$disconnect();
  }
}
void main();
