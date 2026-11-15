import { db } from "./helpers/fixtures";

/**
 * Removes every account in the reserved test namespace (e2e-*@example.test and vt-*@example.test), plus their
 * audit rows and rate-limit counters. Runs before and after the whole suite so an interrupted run
 * (timeouts, Ctrl+C) never leaves test data behind in the development database.
 * Real accounts never use the reserved example.test domain.
 */
export default async function globalCleanup() {
  const client = db();
  const doomed = await client.user.findMany({
    where: { OR: [{ email: { startsWith: "e2e-", endsWith: "@example.test" } }, { email: { startsWith: "vt-", endsWith: "@example.test" } }] },
    select: { id: true },
  });
  const ids = doomed.map((u) => u.id);
  const eventIds = (await client.event.findMany({ where: { OR: [{ createdById: { in: ids } }, { slug: { startsWith: "e2e-" } }, { slug: { startsWith: "vt-" } }] }, select: { id: true } })).map((e) => e.id);
  if (eventIds.length) {
    await client.auditLog.deleteMany({ where: { entityId: { in: eventIds } } });
    await client.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (ids.length) {
    await client.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await client.user.deleteMany({ where: { id: { in: ids } } });
  }
  await client.rateLimit.deleteMany({});
  await client.$disconnect();
}
