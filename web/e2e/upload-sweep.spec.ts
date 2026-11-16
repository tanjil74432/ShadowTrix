import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { E2E_STORAGE_DIR, db, expect, test } from "./helpers/fixtures";

const secret = () => process.env.E2E_CRON_SECRET ?? "";
const URL_PATH = "/api/v1/internal/cleanup";

/** A pending-upload ledger row plus a real object in the local test storage (the e2e server uses the local driver). */
async function makePending(ownerId: string, expiresInMinutes: number) {
  const key = `submissions/${randomUUID()}/${randomUUID()}`;
  const file = path.resolve(E2E_STORAGE_DIR, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "%PDF-1.7 e2e sweep object");
  const now = Date.now();
  await db().pendingUpload.create({
    data: { storageKey: key, submissionId: randomUUID(), ownerId, contentType: "application/pdf", declaredSize: 25, createdAt: new Date(now - 3 * 3_600_000), expiresAt: new Date(now + expiresInMinutes * 60_000) },
  });
  return { key, file };
}

test.describe("abandoned upload cleanup endpoint", () => {
  test("unauthorized attempts delete nothing; with the secret only the expired pending upload is removed, and repeating is harmless", async ({ request, users }) => {
    const owner = await users.create();
    // Other specs may call this endpoint in parallel (an authorized call processes every due row). So this row is NOT yet due while
    // the unauthorized calls run, and is made due only right before the authorized call.
    const expired = await makePending(owner.id, 90);
    const fresh = await makePending(owner.id, 90);
    try {
      // every unauthorized way to call the job
      expect((await request.post(URL_PATH)).status()).toBe(401);
      expect((await request.post(URL_PATH, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
      expect((await request.post(URL_PATH, { headers: { Authorization: `Bearer ${secret().slice(0, -1)}x` } })).status()).toBe(401);
      expect((await request.post(URL_PATH, { headers: { Authorization: secret() } })).status()).toBe(401); // missing the "Bearer" scheme
      expect((await request.get(URL_PATH)).status()).toBe(401); // GET needs the same secret (Vercel Cron)
      expect((await request.put(URL_PATH)).status()).toBe(405);
      expect(fs.existsSync(expired.file), "unauthorized calls must not delete anything").toBe(true);
      expect((await db().pendingUpload.findUniqueOrThrow({ where: { storageKey: expired.key } })).status).toBe("PENDING");

      await db().$executeRaw`UPDATE pending_uploads SET expires_at = now() - interval '30 minutes', created_at = now() - interval '3 hours' WHERE storage_key = ${expired.key}`;
      const ok = await request.post(URL_PATH, { headers: { Authorization: `Bearer ${secret()}` } });
      expect(ok.status()).toBe(200);
      const body = await ok.json();
      // Other specs call the same endpoint in parallel, so per-call counts are not exclusive (a lost race is reported as skippedRaced);
      // the guaranteed outcome is the final state below.
      expect(body.uploads).toMatchObject({ expired: expect.any(Number), skippedAttached: 0, skippedRaced: expect.any(Number) });
      expect(body.storageDeletions).toMatchObject({ failed: 0 });
      expect(JSON.stringify(body)).not.toContain(expired.key); // the response never carries object keys
      // Converges (a parallel authorized call may hold the lease: it deletes the object first and the job row second).
      await expect.poll(() => fs.existsSync(expired.file), { timeout: 15_000 }).toBe(false);
      await expect.poll(async () => (await db().pendingUpload.findUniqueOrThrow({ where: { storageKey: expired.key } })).status, { timeout: 15_000 }).toBe("EXPIRED");
      expect(fs.existsSync(fresh.file), "a not-yet-expired upload is kept").toBe(true);
      expect((await db().pendingUpload.findUniqueOrThrow({ where: { storageKey: fresh.key } })).status).toBe("PENDING");

      // repeating is idempotent
      const again = await request.post(URL_PATH, { headers: { Authorization: `Bearer ${secret()}` } });
      expect(again.status()).toBe(200);
      const second = await again.json();
      expect(second.storageDeletions).toMatchObject({ failed: 0 });
      expect(await db().pendingUpload.count({ where: { storageKey: expired.key, status: "EXPIRED" } })).toBe(1); // still exactly one decision for this upload
      await expect.poll(() => db().storageDeletion.count({ where: { storageKey: expired.key } }), { timeout: 15_000 }).toBe(0);
    } finally {
      for (const f of [expired.file, fresh.file]) fs.rmSync(f, { force: true });
      await db().pendingUpload.deleteMany({ where: { storageKey: { in: [expired.key, fresh.key] } } });
      await db().auditLog.deleteMany({ where: { action: "maintenance.cleanup", entityId: "cleanup" } });
    }
  });
});

test.describe("storage deletion outbox through the maintenance endpoint", () => {
  test("a deleted submission's file is queued by the database and deleted by the worker; unauthorized calls delete nothing", async ({ request, users }) => {
    const organizer = await users.create({ roles: ["ORGANIZER"] });
    const owner = await users.create();
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-outbox-${randomUUID().slice(0, 8)}`, title: "E2E outbox event", category: "HACKATHON", summary: "Outbox test event.", description: "Outbox test.", status: "PUBLISHED", createdById: organizer.id,
        organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - 86_400_000), registrationClosesAt: new Date(now + 5 * 86_400_000),
        startsAt: new Date(now + 6 * 86_400_000), endsAt: new Date(now + 8 * 86_400_000), submissionDeadline: new Date(now + 7 * 86_400_000), capacity: 10,
      },
    });
    const sub = await db().submission.create({ data: { eventId: event.id, ownerId: owner.id, status: "DRAFT", title: "Draft with a file", description: "A draft with one stored file." } });
    const key = `submissions/${sub.id}/${randomUUID()}`;
    const file = path.resolve(E2E_STORAGE_DIR, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "%PDF-1.7 e2e outbox object");
    await db().submissionFile.create({ data: { submissionId: sub.id, storageKey: key, originalName: "a.pdf", mimeType: "application/pdf", sizeBytes: 26 } });
    try {
      await db().$transaction(async (tx) => {
        await tx.submission.delete({ where: { id: sub.id } }); // the file row disappears by cascade; the trigger queues its object ...
        await tx.$executeRaw`UPDATE storage_deletions SET next_attempt_at = now() + interval '1 day' WHERE storage_key = ${key}`; // ... not claimable by parallel runs yet
      });
      expect(await db().submissionFile.count({ where: { storageKey: key } })).toBe(0);
      expect((await db().storageDeletion.findUniqueOrThrow({ where: { storageKey: key } })).reason).toBe("FILE_DELETED");
      expect(fs.existsSync(file)).toBe(true);

      expect((await request.post(URL_PATH)).status()).toBe(401);
      expect((await request.post(URL_PATH, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
      expect(fs.existsSync(file), "unauthorized calls must not delete anything").toBe(true);
      expect(await db().storageDeletion.count({ where: { storageKey: key } })).toBe(1);

      await db().$executeRaw`UPDATE storage_deletions SET next_attempt_at = now() WHERE storage_key = ${key}`;
      const ok = await request.post(URL_PATH, { headers: { Authorization: `Bearer ${secret()}` } });
      expect(ok.status()).toBe(200);
      const body = await ok.json();
      expect(body.storageDeletions).toMatchObject({ claimed: expect.any(Number), deleted: expect.any(Number), failed: 0 });
      expect(JSON.stringify(body)).not.toContain(key);
      await expect.poll(() => fs.existsSync(file), { timeout: 15_000 }).toBe(false);
      await expect.poll(() => db().storageDeletion.count({ where: { storageKey: key } }), { timeout: 15_000 }).toBe(0);
      const again = await request.post(URL_PATH, { headers: { Authorization: `Bearer ${secret()}` } });
      expect((await again.json()).storageDeletions).toMatchObject({ failed: 0 });
      await expect.poll(() => db().storageDeletion.count({ where: { storageKey: key } }), { timeout: 15_000 }).toBe(0);
    } finally {
      fs.rmSync(file, { force: true });
      await db().storageDeletion.deleteMany({ where: { storageKey: key } });
      await db().submission.deleteMany({ where: { eventId: event.id } });
      await db().event.deleteMany({ where: { id: event.id } });
      await db().auditLog.deleteMany({ where: { action: "maintenance.cleanup", entityId: "cleanup" } });
    }
  });
});
