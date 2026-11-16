import { db, E2E_STORAGE_DIR } from "./helpers/fixtures";

/**
 * Removes every account in the reserved test namespace (e2e-*@example.test and vt-*@example.test), plus their
 * audit rows and rate-limit counters. Runs before and after the whole suite so an interrupted run
 * (timeouts, Ctrl+C) never leaves test data behind in the development database.
 * Real accounts never use the reserved example.test domain.
 */
import { rm } from "node:fs/promises";
/** Certificates keep their event and user (ON DELETE RESTRICT), so test cleanup removes them before the events. */
async function removeEventDependants(db: { certificate: { deleteMany: (args: { where: { eventId: { in: string[] } } }) => Promise<unknown> } }, eventIds: string[]) {
  await db.certificate.deleteMany({ where: { eventId: { in: eventIds } } });
}

export default async function globalCleanup() {
  const client = db();
  const doomed = await client.user.findMany({
    where: { OR: [{ email: { startsWith: "e2e-", endsWith: "@example.test" } }, { email: { startsWith: "vt-", endsWith: "@example.test" } }] },
    select: { id: true },
  });
  const ids = doomed.map((u) => u.id);
  const eventIds = (await client.event.findMany({ where: { OR: [{ createdById: { in: ids } }, { slug: { startsWith: "e2e-" } }, { slug: { startsWith: "vt-" } }] }, select: { id: true } })).map((e) => e.id);
  if (eventIds.length) {
    await removeEventDependants(client, eventIds);
    await client.auditLog.deleteMany({ where: { entityId: { in: eventIds } } });
    await client.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (ids.length) {
    await client.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await client.user.deleteMany({ where: { id: { in: ids } } });
  }
  // Leadership and organization records created by the administration tests carry the reserved "E2E " prefix.
  await client.orgMember.deleteMany({ where: { fullName: { startsWith: "E2E " } } });
  await client.organization.deleteMany({ where: { name: { startsWith: "E2E " }, eventHosts: { none: {} } } });
  await client.orgUnit.deleteMany({ where: { name: { startsWith: "E2E " } } });
  await client.designation.deleteMany({ where: { title: { startsWith: "E2E " } } });
  await client.announcement.deleteMany({ where: { title: { startsWith: "E2E " } } });
  await client.siteSetting.deleteMany({ where: { key: { in: ["maintenance_mode", "event_approval_required"] } } }); // e2e switches (never real: production data is not touched by tests)
  await client.rateLimit.deleteMany({});
  await rm(E2E_STORAGE_DIR, { recursive: true, force: true }); // files uploaded by the e2e server
  await client.$disconnect();
}
