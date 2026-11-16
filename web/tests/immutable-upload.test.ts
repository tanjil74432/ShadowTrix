import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { drainStorageDeletions } from "@/server/modules/maintenance/storage-deletion.core";
import { sweepAbandonedUploads } from "@/server/modules/maintenance/upload-sweep.core";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { completeDirectUpload, prepareDirectUpload } from "@/server/modules/submissions/submissions.service";
import { setStorageForTests } from "@/server/storage";
import { cleanup } from "./helpers/auth-harness";
import { iso, organizer, participant, publishedEvent } from "./helpers/event-fixtures";
import { memoryObjectStorage } from "./helpers/memory-object-storage";
import { resetUploadTables } from "./helpers/pending-uploads";

/**
 * Immutable objects: after validation the server writes the validated bytes to a NEW key and attaches only that key, so the signed
 * upload URL (valid up to 15 minutes) can never change an attached file. The temporary upload is deleted after the URL has expired.
 */
const GOOD = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n% good bytes\n")]);
const EVIL = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n% EVIL bytes!\n")]); // same length and still a PDF
let mem: ReturnType<typeof memoryObjectStorage>;
beforeAll(() => { mem = memoryObjectStorage(); setStorageForTests(mem.storage); });
beforeEach(resetUploadTables);
afterEach(async () => { mem.objects.clear(); mem.signed.length = 0; mem.removed.length = 0; Object.assign(mem.control, { failRemoveTimes: 0, failPutTimes: 0, onPut: null }); await cleanup(); await resetUploadTables(); });
afterAll(async () => { setStorageForTests(undefined); await cleanup(); await getDb().$disconnect(); });

type P = Awaited<ReturnType<typeof participant>>;
async function setup() {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const p = await participant();
  await registerForEvent(p.actor, e.id);
  return { e, p };
}
const start = async (p: P, eventId: string, bytes = GOOD) => {
  const out = await prepareDirectUpload(p.actor, eventId, { name: "report.pdf", declaredMime: "application/pdf", size: bytes.length });
  mem.objects.set(out.key, bytes); // the browser's PUT
  return out;
};
const complete = (p: P, eventId: string, key: string) => completeDirectUpload(p.actor, eventId, { key, name: "report.pdf", declaredMime: "application/pdf" });
const drain = (offsetMs = 0, extra = {}) => drainStorageDeletions(getDb(), mem.storage, { now: new Date(Date.now() + offsetMs), ...extra });
const jobs = () => getDb().storageDeletion.findMany({ orderBy: { createdAt: "asc" } });
const permanentKeys = () => [...mem.objects.keys()].filter((k) => k.startsWith("submissions/"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("the attached file is immutable", () => {
  it("attaches a NEW permanent key whose bytes are exactly the validated bytes (and matches the stored SHA-256)", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    const f = await complete(p, e.id, out.key);
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.storageKey).not.toBe(out.key);
    expect(row.storageKey).toMatch(/^submissions\//);
    expect(out.key).toMatch(/^incoming\//);
    const stored = mem.objects.get(row.storageKey)!;
    expect(Buffer.from(stored).equals(Buffer.from(GOOD))).toBe(true);
    expect(row.sha256).toBe(sha(GOOD));
    expect(row.sizeBytes).toBe(GOOD.length);
    expect(permanentKeys()).toEqual([row.storageKey]); // exactly one permanent object
  });

  it("reusing the old signed upload URL after completion (overwrite or new bytes) cannot change the attached file", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    const f = await complete(p, e.id, out.key);
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } });
    mem.objects.set(out.key, EVIL); // the user PUTs again to the still-valid signed URL (same length, same type)
    expect(Buffer.from(mem.objects.get(out.key)!).equals(Buffer.from(EVIL))).toBe(true);
    // the attached object is untouched, still hashes to the recorded SHA-256, and is what a download would serve
    expect(Buffer.from(mem.objects.get(row.storageKey)!).equals(Buffer.from(GOOD))).toBe(true);
    expect(sha(mem.objects.get(row.storageKey)!)).toBe(row.sha256);
    // completing the same upload again is refused and never re-reads the tampered temporary object
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ code: "already_attached" });
    expect(await getDb().submissionFile.count()).toBe(1);
    // and the tampered temporary object is eventually deleted, after the URL has expired
    await drain(60 * 60_000);
    expect(mem.objects.has(out.key)).toBe(false);
    expect(Buffer.from(mem.objects.get(row.storageKey)!).equals(Buffer.from(GOOD))).toBe(true);
  });

  it("the temporary upload is deleted only AFTER its signed URL has expired (15 min + slack), never before", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    await complete(p, e.id, out.key);
    const pending = await getDb().pendingUpload.findUniqueOrThrow({ where: { storageKey: out.key } });
    const [job] = await jobs();
    expect(job).toMatchObject({ storageKey: out.key, reason: "UPLOAD_EXPIRED" });
    const delay = job.nextAttemptAt.getTime() - pending.createdAt.getTime();
    expect(delay).toBeGreaterThanOrEqual(17 * 60_000 - 1000);
    expect(delay).toBeLessThan(18 * 60_000);
    expect(await drain(5 * 60_000)).toMatchObject({ claimed: 0 }); // the URL may still be valid: untouched
    expect(mem.objects.has(out.key)).toBe(true);
    expect(await drain(20 * 60_000)).toMatchObject({ claimed: 1, deleted: 1 }); // URL expired: now it goes
    expect(mem.objects.has(out.key)).toBe(false);
    expect(await jobs()).toHaveLength(0);
  });
});

describe("the copy cannot leave an untracked permanent object", () => {
  it("the permanent key is queued for deletion BEFORE the copy is written, and un-queued only when attached", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    let seen: { reason: string; delayMin: number } | null = null;
    mem.control.onPut = async (key) => {
      if (!key.startsWith("submissions/")) return;
      const guard = await getDb().storageDeletion.findUnique({ where: { storageKey: key } });
      seen = guard ? { reason: guard.reason, delayMin: Math.round((guard.nextAttemptAt.getTime() - Date.now()) / 60_000) } : null;
    };
    await complete(p, e.id, out.key);
    expect(seen).not.toBeNull(); // the guard existed at the moment of the write
    expect(seen!.reason).toBe("UPLOAD_REJECTED");
    expect(seen!.delayMin).toBeGreaterThanOrEqual(25);
    const row = await getDb().submissionFile.findFirstOrThrow({});
    expect(await getDb().storageDeletion.count({ where: { storageKey: row.storageKey } })).toBe(0); // un-queued by the attaching transaction
  });

  it("a failed copy answers 503, leaves the upload PENDING, leaves no permanent object, and the same upload can be retried", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    mem.control.failPutTimes = 1;
    await expect(complete(p, e.id, out.key)).rejects.toMatchObject({ status: 503, code: "storage_unavailable" });
    expect(permanentKeys()).toHaveLength(0);
    expect(await getDb().submissionFile.count()).toBe(0);
    expect((await getDb().pendingUpload.findUniqueOrThrow({ where: { storageKey: out.key } })).status).toBe("PENDING");
    expect(mem.objects.has(out.key)).toBe(true);
    const f = await complete(p, e.id, out.key); // retry succeeds
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(permanentKeys()).toEqual([row.storageKey]);
    await drain(60 * 60_000);
    expect(await jobs()).toHaveLength(0); // the guard of the failed attempt was cleaned up too
  });

  it("a copy that succeeded but whose database attach is refused (file limit) leaves nothing behind: permanent copy and upload are deleted", async () => {
    const { e, p } = await setup();
    for (let i = 0; i < 5; i++) await complete(p, e.id, (await start(p, e.id)).key);
    await drain(60 * 60_000);
    const sixth = await start(p, e.id).catch((err) => err); // refused at step 1 once five exist; so sign it before the fifth is attached instead
    expect(sixth).toMatchObject({ code: "too_many_files" });
    // sign a sixth BEFORE the others were attached, then attach after: build that order explicitly
    const { e: e2, p: p2 } = await setup();
    const extra = await start(p2, e2.id);
    const others = [];
    for (let i = 0; i < 5; i++) others.push(await start(p2, e2.id));
    for (const o of others) await complete(p2, e2.id, o.key);
    await expect(complete(p2, e2.id, extra.key)).rejects.toMatchObject({ code: "too_many_files" });
    await drain(60 * 60_000);
    const attached = (await getDb().submissionFile.findMany({ where: { submission: { eventId: e2.id } } })).map((f) => f.storageKey);
    expect(attached).toHaveLength(5);
    expect(permanentKeys().filter((k) => k.includes(`/${(extra.key.split("/")[1])}/`)).sort()).toEqual([...attached].sort()); // only the five attached copies
    expect(mem.objects.has(extra.key)).toBe(false);
  }, 60_000);

  it("a crash after the copy and before the attach is recovered: the guard job later deletes the unattached permanent object", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    // emulate the process dying right after the copy: guard queued, object written, nothing attached
    const orphanKey = `submissions/${out.key.split("/")[1]}/00000000-0000-4000-8000-000000000001`;
    await getDb().storageDeletion.create({ data: { storageKey: orphanKey, reason: "UPLOAD_REJECTED", nextAttemptAt: new Date(Date.now() + 30 * 60_000) } });
    mem.objects.set(orphanKey, GOOD);
    expect(await drain(5 * 60_000)).toMatchObject({ claimed: 0 }); // not yet: an attach could still be in flight
    expect(await drain(45 * 60_000)).toMatchObject({ claimed: 1, deleted: 1 });
    expect(mem.objects.has(orphanKey)).toBe(false);
  });

  it("the worker never deletes the permanent object if an attached file uses it (even a stale guard job)", async () => {
    const { e, p } = await setup();
    const out = await start(p, e.id);
    const f = await complete(p, e.id, out.key);
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } });
    await getDb().storageDeletion.create({ data: { storageKey: row.storageKey, reason: "UPLOAD_REJECTED" } }); // a leftover guard
    expect(await drain(60 * 60_000)).toMatchObject({ skippedInUse: 1 });
    expect(mem.objects.has(row.storageKey)).toBe(true);
  });
});

describe("races", () => {
  it("two completions of the same upload at once attach exactly one file and leave exactly one permanent object", async () => {
    const { e, p } = await setup();
    for (let round = 0; round < 6; round++) {
      const out = await start(p, e.id);
      const results = await Promise.allSettled([complete(p, e.id, out.key), complete(p, e.id, out.key)]);
      expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
      const files = await getDb().submissionFile.findMany({ where: { submission: { eventId: e.id } } });
      await drain(60 * 60_000);
      expect(permanentKeys().sort(), `round ${round}`).toEqual(files.map((f) => f.storageKey).sort());
      await getDb().submissionFile.deleteMany({ where: { submission: { eventId: e.id } } }); // free the slots
      await drain(60 * 60_000);
      expect(mem.objects.size).toBe(0);
    }
  }, 90_000);

  it("completion racing the cleanup sweep: the file keeps its permanent object, or nothing at all is left", async () => {
    const { e, p } = await setup();
    for (let round = 0; round < 8; round++) {
      const out = await start(p, e.id);
      const [c] = await Promise.allSettled([complete(p, e.id, out.key), sweepAbandonedUploads(getDb(), { now: new Date(Date.now() + 5 * 3_600_000) })]);
      await drain(60 * 60_000);
      const files = await getDb().submissionFile.findMany({ where: { submission: { eventId: e.id } } });
      if (c.status === "fulfilled") {
        expect(files).toHaveLength(1);
        expect(mem.objects.has(files[0].storageKey), `round ${round}: attached file must keep its object`).toBe(true);
        expect(permanentKeys()).toEqual([files[0].storageKey]);
        await getDb().submissionFile.deleteMany({ where: { submission: { eventId: e.id } } });
        await drain(60 * 60_000);
      } else {
        expect(files).toHaveLength(0);
      }
      expect(mem.objects.size, `round ${round}`).toBe(0);
    }
  }, 90_000);
});
