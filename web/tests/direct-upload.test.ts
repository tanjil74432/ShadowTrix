import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { completeDirectUpload, getFileDownloadTarget, prepareDirectUpload } from "@/server/modules/submissions/submissions.service";
import { setStorageForTests } from "@/server/storage";
import { MAX_FILE_BYTES } from "@/server/storage/file-validation";
import { cleanup } from "./helpers/auth-harness";
import { iso, organizer, participant, publishedEvent } from "./helpers/event-fixtures";
import { memoryObjectStorage } from "./helpers/memory-object-storage";
import { resetUploadTables } from "./helpers/pending-uploads";

const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")]);
const text = (s: string) => new Uint8Array(Buffer.from(s));
let mem: ReturnType<typeof memoryObjectStorage>;

beforeAll(async () => { mem = memoryObjectStorage(); setStorageForTests(mem.storage); await resetUploadTables(); });
afterEach(async () => { mem.objects.clear(); mem.signed.length = 0; await cleanup(); await resetUploadTables(); });
afterAll(async () => { setStorageForTests(undefined); await cleanup(); await getDb().$disconnect(); });

async function setup() {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const p = await participant();
  await registerForEvent(p.actor, e.id);
  return { o, e, p };
}
const meta = (over: Partial<{ name: string; declaredMime: string; size: number }> = {}) => ({ name: "report.pdf", declaredMime: "application/pdf", size: PDF.length, ...over });

describe("direct upload step 1: authorize and sign", () => {
  it("issues a URL for one key inside the caller's own submission, bound to the canonical type and exact size", async () => {
    const { e, p } = await setup();
    const out = await prepareDirectUpload(p.actor, e.id, meta());
    const sub = await getDb().submission.findFirstOrThrow({ where: { eventId: e.id, ownerId: p.u.id } });
    expect(out.key).toMatch(new RegExp(`^incoming/${sub.id}/[0-9a-f-]{36}$`)); // temporary upload key
    expect(mem.signed).toEqual([{ key: out.key, contentType: "application/pdf", size: PDF.length }]);
    expect(out.expiresInSeconds).toBe(900);
    expect(out.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("refuses before signing: bad type, mismatched MIME, empty, too large, wrong role, closed event, too many files", async () => {
    const { e, p, o } = await setup();
    for (const bad of [meta({ name: "run.exe" }), meta({ declaredMime: "image/png" }), meta({ size: 0 }), meta({ size: MAX_FILE_BYTES + 1 })]) {
      await expect(prepareDirectUpload(p.actor, e.id, bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "invalid_file" });
    }
    await expect(prepareDirectUpload(o.actor, e.id, meta())).rejects.toBeDefined(); // not a registered participant
    await expect(prepareDirectUpload(p.actor, e.id, meta(), new Date(Date.now() + 30 * 86_400_000))).rejects.toMatchObject({ code: "submission_closed" });
    expect(mem.signed).toHaveLength(0);
  });

  it("answers 501 on drivers without direct access (local disk), so the browser falls back to the normal upload", async () => {
    const { e, p } = await setup();
    setStorageForTests({ put: async () => undefined, get: async () => null, remove: async () => undefined });
    try {
      await expect(prepareDirectUpload(p.actor, e.id, meta())).rejects.toMatchObject({ status: 501, code: "direct_upload_unavailable" });
    } finally {
      setStorageForTests(mem.storage);
    }
  });
});

describe("direct upload step 2: verify the stored bytes, then attach", () => {
  async function upload(p: Awaited<ReturnType<typeof setup>>["p"], eventId: string, bytes: Uint8Array, over = {}) {
    const out = await prepareDirectUpload(p.actor, eventId, meta({ size: bytes.length, ...over }));
    mem.objects.set(out.key, bytes); // what the browser's PUT to the bucket would have stored
    return out;
  }

  it("attaches a valid object: stores size, canonical type and SHA-256 under a NEW permanent key, writes an audit row", async () => {
    const { e, p } = await setup();
    const out = await upload(p, e.id, PDF);
    const saved = await completeDirectUpload(p.actor, e.id, { key: out.key, name: "../../My Report.pdf", declaredMime: "application/pdf" });
    expect(saved).toMatchObject({ name: "My Report.pdf", mimeType: "application/pdf", sizeBytes: PDF.length });
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.storageKey).not.toBe(out.key); // the attached key is a new immutable key, not the upload key
    expect(row.storageKey).toMatch(new RegExp(`^submissions/${row.submissionId}/[0-9a-f-]{36}$`));
    expect(Buffer.from(mem.objects.get(row.storageKey)!).equals(Buffer.from(PDF))).toBe(true);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await getDb().auditLog.count({ where: { action: "submission.file_added", entityId: row.submissionId } })).toBe(1);
    expect(mem.objects.has(row.storageKey)).toBe(true);
  });

  it("deletes an object whose real content does not match its extension (a renamed file), and attaches nothing", async () => {
    const { e, p } = await setup();
    const out = await upload(p, e.id, text("<html>not a pdf</html>"), { name: "fake.pdf", size: 22 });
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "fake.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ code: "invalid_file" });
    expect(mem.objects.has(out.key)).toBe(false);
    expect(await getDb().submissionFile.count()).toBe(0);
  });

  it("deletes an object that is larger than 10 MB even if it was signed for less", async () => {
    const { e, p } = await setup();
    const out = await prepareDirectUpload(p.actor, e.id, meta({ name: "big.txt", declaredMime: "text/plain", size: 10 }));
    mem.objects.set(out.key, new Uint8Array(MAX_FILE_BYTES + 5).fill(0x61));
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "big.txt", declaredMime: "text/plain" })).rejects.toMatchObject({ code: "invalid_file" });
    expect(mem.objects.has(out.key)).toBe(false);
  });

  it("never finds another person's upload or a key outside the caller's submission, and does not touch those objects", async () => {
    const { e, p } = await setup();
    const q = await participant();
    await registerForEvent(q.actor, e.id);
    const mine = await upload(p, e.id, PDF);
    const theirs = await upload(q, e.id, PDF);
    await expect(completeDirectUpload(p.actor, e.id, { key: theirs.key, name: "x.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ status: 404 });
    for (const bad of ["submissions/not-a-uuid/also-not", "../secrets", "submissions/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000", ""]) {
      await expect(completeDirectUpload(p.actor, e.id, { key: bad, name: "x.pdf", declaredMime: "application/pdf" }), bad).rejects.toMatchObject({ status: 404 });
    }
    expect(mem.objects.has(theirs.key)).toBe(true);
    expect(mem.objects.has(mine.key)).toBe(true);
  });

  it("answers 404 for a key that was signed but never uploaded", async () => {
    const { e, p } = await setup();
    const out = await prepareDirectUpload(p.actor, e.id, meta());
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ status: 404 });
  });

  it("cannot attach the same object twice, and the second attempt does not delete it", async () => {
    const { e, p } = await setup();
    const out = await upload(p, e.id, PDF);
    await completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" });
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ code: "already_attached" });
    expect(mem.objects.has(out.key)).toBe(true);
    expect(await getDb().submissionFile.count()).toBe(1);
  });

  it("enforces the 5-file limit: the sixth is refused at step 1, and a sixth already-uploaded object is removed at step 2", async () => {
    const { e, p } = await setup();
    const pending = [];
    for (let i = 0; i < 5; i++) pending.push(await upload(p, e.id, PDF)); // all five signed while the project had no files yet
    const extra = await upload(p, e.id, PDF); // a sixth signed before any was attached
    for (const out of pending) await completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" });
    await expect(prepareDirectUpload(p.actor, e.id, meta())).rejects.toMatchObject({ code: "too_many_files" });
    await expect(completeDirectUpload(p.actor, e.id, { key: extra.key, name: "report.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ code: "too_many_files" });
    expect(mem.objects.has(extra.key)).toBe(false);
    expect(await getDb().submissionFile.count()).toBe(5);
  }, 30_000);

  it("a closed submission window removes the uploaded object", async () => {
    const { e, p } = await setup();
    const out = await upload(p, e.id, PDF);
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" }, new Date(Date.now() + 30 * 86_400_000))).rejects.toMatchObject({ code: "submission_closed" });
    expect(mem.objects.has(out.key)).toBe(false);
  });
});

describe("download: object storage redirects to a 60-second signed URL after authorization", () => {
  it("authorized people get a forced-attachment redirect; strangers get 404 and no URL", async () => {
    const { e, p, o } = await setup();
    const out = await prepareDirectUpload(p.actor, e.id, meta());
    mem.objects.set(out.key, PDF);
    const saved = await completeDirectUpload(p.actor, e.id, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" });
    for (const actor of [p.actor, o.actor]) {
      const t = await getFileDownloadTarget(actor, saved.id);
      expect("redirectTo" in t && t.redirectTo).toContain((await getDb().submissionFile.findUniqueOrThrow({ where: { id: saved.id } })).storageKey);
      expect("redirectTo" in t && t.redirectTo).toContain("exp=60");
      expect("redirectTo" in t && decodeURIComponent(t.redirectTo)).toContain("attachment");
    }
    const stranger = await participant();
    await expect(getFileDownloadTarget(stranger.actor, saved.id)).rejects.toMatchObject({ status: 404 });
  });
});
