import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { runCleanup } from "@/server/modules/maintenance/cleanup.core";
import { drainStorageDeletions } from "@/server/modules/maintenance/storage-deletion.core";
import { sweepAbandonedUploads } from "@/server/modules/maintenance/upload-sweep.core";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { completeDirectUpload, prepareDirectUpload } from "@/server/modules/submissions/submissions.service";
import { setStorageForTests } from "@/server/storage";
import { cleanup } from "./helpers/auth-harness";
import { iso, organizer, participant, publishedEvent } from "./helpers/event-fixtures";
import { memoryObjectStorage } from "./helpers/memory-object-storage";
import { resetUploadTables } from "./helpers/pending-uploads";

const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")]);
const TTL_MS = () => getEnv().PENDING_UPLOAD_TTL_MINUTES * 60_000;
let mem: ReturnType<typeof memoryObjectStorage>;

beforeAll(() => { mem = memoryObjectStorage(); setStorageForTests(mem.storage); });
beforeEach(resetUploadTables);
afterEach(async () => { mem.objects.clear(); mem.signed.length = 0; mem.removed.length = 0; mem.control.failRemoveTimes = 0; await cleanup(); await resetUploadTables(); });
afterAll(async () => { setStorageForTests(undefined); await cleanup(); await getDb().$disconnect(); });

async function setup() {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const p = await participant();
  await registerForEvent(p.actor, e.id);
  return { e, p };
}
/** What the browser does: step 1, then the PUT to the bucket (the object appears in the store). */
async function startUpload(p: Awaited<ReturnType<typeof setup>>["p"], eventId: string, bytes = PDF, uploaded = true) {
  const out = await prepareDirectUpload(p.actor, eventId, { name: "report.pdf", declaredMime: "application/pdf", size: bytes.length });
  if (uploaded) mem.objects.set(out.key, bytes);
  return out;
}
const row = (key: string) => getDb().pendingUpload.findUniqueOrThrow({ where: { storageKey: key } });
const sweep = (offsetMs: number, extra = {}) => sweepAbandonedUploads(getDb(), { now: new Date(Date.now() + offsetMs), ...extra });
const drain = (offsetMs = 0) => drainStorageDeletions(getDb(), mem.storage, { now: new Date(Date.now() + offsetMs) });
const complete = (p: Awaited<ReturnType<typeof setup>>["p"], eventId: string, key: string) => completeDirectUpload(p.actor, eventId, { key, name: "report.pdf", declaredMime: "application/pdf" });
const jobs = () => getDb().storageDeletion.findMany({ orderBy: { createdAt: "asc" } });

describe("pending upload ledger", () => {
  it("every signed upload gets a row: unique server key, owner, contentType, declared size, creation and expiry (configurable), status PENDING", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    const r = await row(out.key);
    expect(r).toMatchObject({ ownerId: p.u.id, contentType: "application/pdf", declaredSize: PDF.length, status: "PENDING", resolvedAt: null });
    expect(r.expiresAt.getTime() - r.createdAt.getTime()).toBeGreaterThan(TTL_MS() - 5_000);
    expect(r.expiresAt.getTime() - r.createdAt.getTime()).toBeLessThan(TTL_MS() + 5_000);
    expect(getEnv().PENDING_UPLOAD_TTL_MINUTES).toBeGreaterThanOrEqual(20); // always longer than the 15-minute URL validity
    expect((await startUpload(p, e.id)).key).not.toBe(out.key);
  });

  it("refused requests leave no row behind", async () => {
    const { e, p } = await setup();
    await expect(prepareDirectUpload(p.actor, e.id, { name: "run.exe", declaredMime: "", size: 10 })).rejects.toMatchObject({ code: "invalid_file" });
    expect(await getDb().pendingUpload.count()).toBe(0);
  });
});

describe("abandoned upload cleanup: expire the row and queue the object (no storage call); the outbox worker deletes it", () => {
  it("an expired pending upload is marked EXPIRED and queued in the same step; the worker then deletes the object", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    expect(await sweep(TTL_MS() + 60_000)).toMatchObject({ expired: 1 });
    expect(mem.objects.has(out.key)).toBe(true); // the sweep itself never touches the store
    expect(mem.removed).toEqual([]);
    expect(await row(out.key)).toMatchObject({ status: "EXPIRED" });
    expect((await jobs()).map((j) => [j.storageKey, j.reason])).toEqual([[out.key, "UPLOAD_EXPIRED"]]);
    expect(await drain()).toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
    expect(mem.objects.has(out.key)).toBe(false);
    expect(await jobs()).toHaveLength(0);
  });

  it("keeps an upload that has not expired yet", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    expect(await sweep(TTL_MS() - 60_000)).toMatchObject({ expired: 0 });
    expect(await jobs()).toHaveLength(0);
    expect(mem.objects.has(out.key)).toBe(true);
    expect((await row(out.key)).status).toBe("PENDING");
  });

  it("keeps a completed upload and the submission file that uses it, even long after the expiry time", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    const file = await complete(p, e.id, out.key);
    const finalKey = (await getDb().submissionFile.findUniqueOrThrow({ where: { id: file.id } })).storageKey;
    expect(await sweep(TTL_MS() * 10)).toMatchObject({ expired: 0 });
    expect(await drain()).toMatchObject({ claimed: 0 }); // the temporary upload's delayed deletion is not due yet
    expect(mem.objects.has(finalKey)).toBe(true);
    expect((await row(out.key)).status).toBe("COMPLETED");
  });

  it("an attached file is never touched, even if its upload's ledger row is wrongly PENDING again (only the temporary key is queued)", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    const file = await complete(p, e.id, out.key);
    const finalKey = (await getDb().submissionFile.findUniqueOrThrow({ where: { id: file.id } })).storageKey;
    await getDb().$executeRaw`UPDATE pending_uploads SET status = 'PENDING', resolved_at = NULL WHERE storage_key = ${out.key}`; // simulate corruption
    await sweep(TTL_MS() * 10);
    await drain(TTL_MS() * 10);
    expect(mem.objects.has(finalKey)).toBe(true); // the attached permanent object survives everything
    expect(mem.objects.has(out.key)).toBe(false); // only the temporary key was reaped
    expect(await getDb().submissionFile.count({ where: { id: file.id } })).toBe(1);
  });

  it("the sweep never queues a key that a submission file points at", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    await getDb().$executeRaw`UPDATE pending_uploads SET expires_at = now() - interval '1 hour', created_at = now() - interval '2 hours' WHERE storage_key = ${out.key}`;
    const sub = await getDb().submission.findFirstOrThrow({ where: { eventId: e.id } });
    await getDb().submissionFile.create({ data: { submissionId: sub.id, storageKey: out.key, originalName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 } }); // a file somehow points at the key
    expect(await sweep(60_000)).toMatchObject({ skippedAttached: 1, expired: 0 });
    expect(await jobs()).toHaveLength(0);
    expect(mem.objects.has(out.key)).toBe(true);
  });

  it("is idempotent: repeated sweeps and drains find nothing more and the object is deleted exactly once", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    await sweep(TTL_MS() + 60_000);
    expect((await drain()).deleted).toBe(1);
    for (let i = 0; i < 2; i++) {
      expect(await sweep(TTL_MS() + 60_000)).toEqual({ expired: 0, skippedAttached: 0, skippedRaced: 0, ledgerRowsRemoved: 0 });
      expect(await drain()).toEqual({ claimed: 0, deleted: 0, skippedInUse: 0, failed: 0 });
    }
    expect(mem.removed).toEqual([out.key]);
  });

  it("handles a signed upload whose object was never uploaded (missing object)", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id, PDF, false);
    await sweep(TTL_MS() + 60_000);
    expect(await drain()).toMatchObject({ deleted: 1, failed: 0 });
    expect((await row(out.key)).status).toBe("EXPIRED");
    expect(await jobs()).toHaveLength(0);
  });

  it("handles only a batch per run and picks up the rest next time", async () => {
    const { e, p } = await setup();
    for (let i = 0; i < 3; i++) await startUpload(p, e.id);
    expect(await sweep(TTL_MS() + 60_000, { batchSize: 2 })).toMatchObject({ expired: 2 });
    expect(await sweep(TTL_MS() + 60_000, { batchSize: 2 })).toMatchObject({ expired: 1 });
  });

  it("only touches uploads: other objects in the store, and completed uploads, are left alone", async () => {
    const { e, p } = await setup();
    mem.objects.set("photos/unrelated/object", new Uint8Array([1])); // not tracked by any pending row
    const done = await startUpload(p, e.id);
    const doneFile = await complete(p, e.id, done.key);
    const doneKey = (await getDb().submissionFile.findUniqueOrThrow({ where: { id: doneFile.id } })).storageKey;
    const old = await startUpload(p, e.id);
    await sweep(TTL_MS() + 60_000);
    await drain();
    expect(mem.objects.has("photos/unrelated/object")).toBe(true);
    expect(mem.objects.has(doneKey)).toBe(true);
    expect(mem.objects.has(old.key)).toBe(false);
  });

  it("removes old resolved ledger rows but never a PENDING one", async () => {
    const { e, p } = await setup();
    const keep = await startUpload(p, e.id);
    const dead = await startUpload(p, e.id);
    await sweep(TTL_MS() + 60_000, { batchSize: 1 }); // expires one of them
    expect(await getDb().pendingUpload.findMany({ where: { status: "EXPIRED" } })).toHaveLength(1);
    const res = await sweep(TTL_MS() + 40 * 86_400_000, { batchSize: 0 });
    expect(res.ledgerRowsRemoved).toBe(1);
    expect(await getDb().pendingUpload.count({ where: { storageKey: { in: [keep.key, dead.key] } } })).toBe(1); // the PENDING row survives
  });
});

describe("a reaped upload cannot be completed, and a completed one cannot be reaped", () => {
  it("completing after the cleanup job expired the upload fails with 410 and does not bring the object back", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    await sweep(TTL_MS() + 60_000);
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ status: 410, code: "upload_expired" });
    expect(await getDb().submissionFile.count()).toBe(0);
    await drain();
    expect(mem.objects.has(out.key)).toBe(false);
  });

  it("completing when the object is already past its expiry (job has not run yet) is refused atomically and does not attach", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    await getDb().$executeRaw`UPDATE pending_uploads SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 minutes' WHERE storage_key = ${out.key}`;
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ code: "upload_expired" });
    expect(await getDb().submissionFile.count()).toBe(0);
    expect((await row(out.key)).status).toBe("PENDING"); // left for the job to reap
    expect(mem.objects.has(out.key)).toBe(true);
    expect(await sweep(60_000)).toMatchObject({ expired: 1 });
    expect(await drain()).toMatchObject({ deleted: 1 });
  });

  it("a rejected upload (content does not match) is marked REJECTED, its object is deleted at once, and the job leaves it alone", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id, new Uint8Array(Buffer.from("<html>not a pdf</html>")));
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ code: "invalid_file" });
    expect((await row(out.key)).status).toBe("REJECTED");
    expect(mem.objects.has(out.key)).toBe(false);
    expect(await jobs()).toHaveLength(0); // queued and already processed
    expect(await sweep(TTL_MS() * 2)).toMatchObject({ expired: 0 });
  });

  it("a rejected upload whose deletion fails stays queued and is retried (nothing is forgotten)", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id, new Uint8Array(Buffer.from("<html>not a pdf</html>")));
    mem.control.failRemoveTimes = 1;
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ code: "invalid_file" });
    expect(mem.objects.has(out.key)).toBe(true);
    expect((await jobs()).map((j) => j.reason)).toEqual(["UPLOAD_REJECTED"]);
    expect(await drain(10 * 60_000)).toMatchObject({ deleted: 1 });
    expect(mem.objects.has(out.key)).toBe(false);
  });

  it("RACE: completion and cleanup at the same moment never leave an attached file without its object, nor an orphan object", async () => {
    const { e, p } = await setup();
    let completedWins = 0, cleanupWins = 0;
    for (let round = 0; round < 12; round++) {
      const out = await startUpload(p, e.id);
      const [c] = await Promise.allSettled([complete(p, e.id, out.key), sweep(TTL_MS() + 60_000)]);
      await drain();
      const r = await row(out.key);
      const file = r.status === "COMPLETED" ? await getDb().submissionFile.findFirst({ where: { submission: { eventId: e.id } }, orderBy: { createdAt: "desc" } }) : null;
      if (file) {
        completedWins++;
        expect(c.status, `round ${round}`).toBe("fulfilled");
        expect(mem.objects.has(file.storageKey), "attached file must keep its permanent object").toBe(true);
        expect(mem.removed).not.toContain(file.storageKey);
        await getDb().submissionFile.delete({ where: { id: file.id } }); // free the slot (the trigger queues this object)
        await drain(60 * 60_000); // also removes the temporary upload (its delayed job)
        expect(mem.objects.size, "everything is gone after the file is deleted").toBe(0);
      } else {
        cleanupWins++;
        expect(["EXPIRED", "REJECTED"]).toContain(r.status);
        expect(c.status).toBe("rejected");
        await drain(60 * 60_000);
        expect(mem.objects.size, "reaped upload leaves no object, temporary or permanent").toBe(0);
      }
    }
    expect(completedWins + cleanupWins).toBe(12);
    expect(await jobs()).toHaveLength(0);
  }, 90_000);
});

describe("housekeeping core stays separate", () => {
  it("the original cleanup job does not touch uploads or storage", async () => {
    const { e, p } = await setup();
    const out = await startUpload(p, e.id);
    await runCleanup(getDb(), { now: new Date(Date.now() + TTL_MS() * 10), audit: false });
    expect(mem.objects.has(out.key)).toBe(true);
    expect((await row(out.key)).status).toBe("PENDING");
  });
});
