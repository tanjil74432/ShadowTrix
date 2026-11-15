/**
 * Runs the housekeeping job once from the command line:  npm run maintenance:cleanup
 * Safe to run repeatedly (for example daily from cron). It only removes expired sessions and tokens, old rate-limit
 * counters and stale unverified signups, and it prints what it removed. See src/server/modules/maintenance/cleanup.core.ts.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runCleanup } from "../src/server/modules/maintenance/cleanup.core";

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    console.log(JSON.stringify(await runCleanup(db)));
  } finally {
    await db.$disconnect();
  }
}
void main();
