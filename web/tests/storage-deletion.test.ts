import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { backoffSeconds, drainStorageDeletions, drainStorageDeletionsAll, enqueueStorageDeletion } from "@/server/modules/maintenance/storage-deletion.core";
import { sweepAbandonedUploads } from "@/server/modules/maintenance/upload-sweep.core";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { completeDirectUpload, deleteFile, prepareDirectUpload, saveDraft, submitProject } from "@/server/modules/submissions/submissions.service";
import { submissionSchema } from "@/server/modules/submissions/submissions.schema";
import { createTeam, disbandTeam, inviteMember, leaveTeam, registerTeam, respondToInvitation } from "@/server/modules/teams/teams.service";
import { createTeamSchema } from "@/server/modules/teams/teams.schema";
import { setStorageForTests } from "@/server/storage";
import { cleanup, makeHarness, tokenFrom } from "./helpers/auth-harness";
import { iso, organizer, participant, publishedEvent, teamEvent } from "./helpers/event-fixtures";
import { memoryObjectStorage } from "./helpers/memory-object-storage";
import { resetUploadTables } from "./helpers/pending-uploads";

const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")]);
let mem: ReturnType<typeof memoryObjectStorage>;
beforeAll(() => { mem = memoryObjectStorage(); setStorageForTests(mem.storage); });
beforeEach(resetUploadTables);
afterEach(async () => { mem.objects.clear(); mem.signed.length = 0; mem.removed.length = 0; mem.control.failRemoveTimes = 0; await cleanup(); await resetUploadTables(); });
afterAll(async () => { setStorageForTests(undefined); await cleanup(); await getDb().$disconnect(); });

type P = Awaited<ReturnType<typeof participant>>;
const drain = (offsetMs = 0, extra = {}) => drainStorageDeletions(getDb(), mem.storage, { now: new Date(Date.now() + offsetMs), ...extra });
const jobs = () => getDb().storageDeletion.findMany({ orderBy: { createdAt: "asc" } });
const input = () => submissionSchema.parse({ title: "Our project", description: "A description of the project that is long enough.", repoUrl: "https://github.com/example/repo" });

/**
 * The browser's two steps plus the PUT, ending with a validated, attached file. Returns the PERMANENT (immutable) key. The temporary
 * upload is deleted only after its signed URL expired, so this simulates that moment: each test then starts with just the permanent object.
 */
async function attach(p: P, eventId: string) {
  const out = await prepareDirectUpload(p.actor, eventId, { name: "report.pdf", declaredMime: "application/pdf", size: PDF.length });
  mem.objects.set(out.key, PDF);
  const f = await completeDirectUpload(p.actor, eventId, { key: out.key, name: "report.pdf", declaredMime: "application/pdf" });
  const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } });
  await drain(60 * 60_000, { keys: [out.key] });
  return { key: row.storageKey, id: f.id, tempKey: out.key };
}
async function individual() {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const p = await participant();
  await registerForEvent(p.actor, e.id);
  return { o, e, p };
}
async function registeredTeam() {
  const o = await organizer();
  const e = await teamEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const h = makeHarness();
  const leader = await participant();
  const member = await participant();
  const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: `vt outbox ${randomUUID().slice(0, 8)}` }));
  await inviteMember(leader.actor, team.id, member.u.email, h.deps);
  await h.flush();
  await respondToInvitation(member.actor, { token: tokenFrom(h.lastMailTo(member.u.email)) }, true);
  await registerTeam(leader.actor, team.id);
  return { o, e, leader, member, team };
}

describe("team disbanding (the confirmed bug)", () => {
  it("deletes the draft submission, queues every file in the SAME transaction, and the objects are removed", async () => {
    const { e, leader, team } = await registeredTeam();
    const a = await attach(leader, e.id);
    const b = await attach(leader, e.id);
    mem.control.failRemoveTimes = 99; // the immediate best-effort pass inside disbandTeam cannot reach the store ...
    await disbandTeam(leader.actor, team.id);
    expect(await getDb().submission.count({ where: { eventId: e.id } })).toBe(0);
    expect(await getDb().submissionFile.count()).toBe(0);
    // ... so the database records are gone but the jobs are durably queued, and the objects still exist
    expect((await jobs()).map((j) => [j.storageKey, j.reason]).sort()).toEqual([[a.key, "FILE_DELETED"], [b.key, "FILE_DELETED"]].sort());
    expect(mem.objects.has(a.key) && mem.objects.has(b.key)).toBe(true);
    mem.control.failRemoveTimes = 0;
    expect(await drain(10 * 60_000)).toMatchObject({ deleted: 2, failed: 0 });
    expect(mem.objects.size).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });

  it("with a healthy store the objects are deleted immediately by disbandTeam itself", async () => {
    const { e, leader, team } = await registeredTeam();
    await attach(leader, e.id);
    await disbandTeam(leader.actor, team.id);
    expect(mem.objects.size).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });

  it("a leader leaving alone (which disbands the team) is covered the same way", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8), minTeamSize: 1, maxTeamSize: 3 });
    const leader = await participant();
    const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: `vt solo ${randomUUID().slice(0, 8)}` }));
    await registerTeam(leader.actor, team.id);
    const f = await attach(leader, e.id);
    await leaveTeam(leader.actor, team.id);
    expect(await getDb().submissionFile.count()).toBe(0);
    expect(mem.objects.has(f.key)).toBe(false);
  });

  it("a team with a SUBMITTED project still cannot be disbanded, and nothing is queued", async () => {
    const { e, leader, team } = await registeredTeam();
    const f = await attach(leader, e.id);
    await submitProject(leader.actor, e.id, input());
    await expect(disbandTeam(leader.actor, team.id)).rejects.toMatchObject({ code: "team_has_submission" });
    expect(await jobs()).toHaveLength(0);
    expect(mem.objects.has(f.key)).toBe(true);
  });
});

describe("other deletion paths all reach the outbox (database trigger)", () => {
  it("deleting an event with several submissions and files queues all of them; nothing is lost", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await participant();
      await registerForEvent(p.actor, e.id);
      keys.push((await attach(p, e.id)).key, (await attach(p, e.id)).key);
    }
    await getDb().event.delete({ where: { id: e.id } }); // cascades into registrations, submissions and files
    expect(await getDb().submissionFile.count()).toBe(0);
    expect((await jobs()).map((j) => j.storageKey).sort()).toEqual([...keys].sort());
    expect(keys.every((k) => mem.objects.has(k))).toBe(true); // the database delete itself never touches the store
    expect(await drainStorageDeletionsAll(getDb(), mem.storage, { now: new Date(Date.now() + 1000) })).toMatchObject({ deleted: 6, failed: 0 });
    expect(mem.objects.size).toBe(0);
  });

  it("deleting a submission directly queues all its files, including a submitted project with several versions", async () => {
    const { e, p } = await individual();
    await attach(p, e.id);
    await submitProject(p.actor, e.id, input()); // version 1
    await attach(p, e.id); // a change after submitting creates version 2
    await attach(p, e.id); // version 3
    const sub = await getDb().submission.findFirstOrThrow({ where: { eventId: e.id } });
    expect(await getDb().submissionVersion.count({ where: { submissionId: sub.id } })).toBeGreaterThanOrEqual(3);
    await getDb().submission.delete({ where: { id: sub.id } });
    expect(await jobs()).toHaveLength(3);
    expect(await drain(1000)).toMatchObject({ deleted: 3 });
    expect(mem.objects.size).toBe(0);
  });

  it("deleting one file through the service queues and deletes exactly that object", async () => {
    const { e, p } = await individual();
    const a = await attach(p, e.id);
    const b = await attach(p, e.id);
    await deleteFile(p.actor, e.id, a.id);
    expect(mem.objects.has(a.key)).toBe(false);
    expect(mem.objects.has(b.key)).toBe(true);
    expect(await jobs()).toHaveLength(0);
  });

  it("replacing or deleting a member photo queues the old object; certificates and photos use the same trigger", async () => {
    const m = await getDb().orgMember.create({ data: { slug: `vt-ob-${randomUUID().slice(0, 8)}`, fullName: "VT Outbox", photoKey: `org-members/${randomUUID()}/${randomUUID()}` } });
    try {
      const first = m.photoKey!;
      const second = `org-members/${m.id}/${randomUUID()}`;
      await getDb().orgMember.update({ where: { id: m.id }, data: { photoKey: second } });
      expect((await jobs()).map((j) => [j.storageKey, j.reason])).toEqual([[first, "PHOTO_DELETED"]]);
      await getDb().orgMember.update({ where: { id: m.id }, data: { fullName: "Renamed" } }); // unrelated update: no job
      expect(await jobs()).toHaveLength(1);
      await getDb().orgMember.delete({ where: { id: m.id } });
      expect((await jobs()).map((j) => j.storageKey).sort()).toEqual([first, second].sort());
    } finally {
      await getDb().orgMember.deleteMany({ where: { id: m.id } });
    }
  });
});

describe("worker behaviour", () => {
  it("success: the object is deleted first, then the job row", async () => {
    await enqueueStorageDeletion(getDb(), "submissions/a/b", "FILE_DELETED");
    mem.objects.set("submissions/a/b", PDF);
    expect(await drain()).toEqual({ claimed: 1, deleted: 1, skippedInUse: 0, failed: 0 });
    expect(mem.objects.size).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });

  it("failure and retry: the job stays with a backoff, an attempt count and a short error code (no key, no detail)", async () => {
    await enqueueStorageDeletion(getDb(), "submissions/a/b", "FILE_DELETED");
    mem.objects.set("submissions/a/b", PDF);
    mem.control.failRemoveTimes = 1;
    expect(await drain()).toMatchObject({ claimed: 1, deleted: 0, failed: 1 });
    const [j] = await jobs();
    expect(j).toMatchObject({ attempts: 1, lockedUntil: null, lastErrorCode: "Error" });
    expect(j.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000); // backoff: not retried immediately
    expect(await drain()).toMatchObject({ claimed: 0 });
    expect(mem.objects.has("submissions/a/b")).toBe(true);
    expect(await drain(2 * 60_000)).toMatchObject({ claimed: 1, deleted: 1 });
    expect(await jobs()).toHaveLength(0);
  });

  it("backoff grows exponentially and is capped", () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([60, 120, 240, 480]);
    expect(backoffSeconds(40)).toBe(6 * 3600);
  });

  it("duplicate workers at the same time never process the same job twice", async () => {
    for (let i = 0; i < 12; i++) {
      const key = `submissions/dup/${i}`;
      mem.objects.set(key, PDF);
      await enqueueStorageDeletion(getDb(), key, "FILE_DELETED");
    }
    const results = await Promise.all([1, 2, 3].map(() => drain(0, { batchSize: 4 })));
    expect(results.reduce((n, r) => n + r.deleted, 0)).toBe(12);
    expect(mem.removed).toHaveLength(12);
    expect(new Set(mem.removed).size).toBe(12); // each object removed exactly once
    expect(await jobs()).toHaveLength(0);
  });

  it("the same key queued twice collapses into one job", async () => {
    await enqueueStorageDeletion(getDb(), "submissions/a/b", "FILE_DELETED");
    await enqueueStorageDeletion(getDb(), "submissions/a/b", "UPLOAD_EXPIRED");
    expect(await jobs()).toHaveLength(1);
  });

  it("worker crash and recovery: a claimed job is skipped while its lease is valid and picked up after it ends", async () => {
    mem.objects.set("submissions/crash/1", PDF);
    await enqueueStorageDeletion(getDb(), "submissions/crash/1", "FILE_DELETED");
    // a worker claims the job (lease 5 minutes) and then dies before deleting anything
    const claimed = await getDb().$queryRaw<{ id: string }[]>`UPDATE storage_deletions SET locked_until = now() + interval '5 minutes', attempts = attempts + 1 RETURNING id`;
    expect(claimed).toHaveLength(1);
    expect(await drain(60_000)).toMatchObject({ claimed: 0 }); // another worker must not take it yet
    expect(mem.objects.has("submissions/crash/1")).toBe(true);
    expect(await drain(10 * 60_000)).toMatchObject({ claimed: 1, deleted: 1 }); // lease over: recovered
    expect(mem.objects.size).toBe(0);
  });

  it("a missing storage object is not an error: the job completes", async () => {
    await enqueueStorageDeletion(getDb(), "submissions/never/existed", "FILE_DELETED");
    expect(await drain()).toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
    expect(await jobs()).toHaveLength(0);
  });

  it("never deletes an object that a live record still uses: the job is dropped and the object kept", async () => {
    const { e, p } = await individual();
    const f = await attach(p, e.id);
    await enqueueStorageDeletion(getDb(), f.key, "FILE_DELETED"); // a wrong or stale job for an attached file
    expect(await drain()).toMatchObject({ claimed: 1, deleted: 0, skippedInUse: 1 });
    expect(mem.objects.has(f.key)).toBe(true);
    expect(await getDb().submissionFile.count()).toBe(1);
    expect(await jobs()).toHaveLength(0);
  });

  it("only the requested keys are processed when a key list is given (post-commit best effort)", async () => {
    for (const k of ["submissions/x/1", "submissions/x/2"]) { mem.objects.set(k, PDF); await enqueueStorageDeletion(getDb(), k, "FILE_DELETED"); }
    expect(await drain(0, { keys: ["submissions/x/1"] })).toMatchObject({ claimed: 1, deleted: 1 });
    expect(mem.objects.has("submissions/x/2")).toBe(true);
    expect((await jobs()).map((j) => j.storageKey)).toEqual(["submissions/x/2"]);
  });
});

describe("transactions and races", () => {
  it("database rollback: a rolled-back deletion leaves the file AND creates no job", async () => {
    const { e, p } = await individual();
    const f = await attach(p, e.id);
    await expect(getDb().$transaction(async (tx) => {
      await tx.submissionFile.delete({ where: { id: f.id } });
      expect(await tx.storageDeletion.count()).toBe(1); // visible inside the transaction ...
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    expect(await getDb().submissionFile.count({ where: { id: f.id } })).toBe(1); // ... gone after the rollback
    expect(await jobs()).toHaveLength(0);
    expect(mem.objects.has(f.key)).toBe(true);
  });

  it("object deleted but job-row delete lost (crash in between): the retry finds the object already gone and finishes", async () => {
    await enqueueStorageDeletion(getDb(), "submissions/half/1", "FILE_DELETED");
    mem.objects.set("submissions/half/1", PDF);
    mem.objects.delete("submissions/half/1"); // the previous run deleted the object, then died before deleting the row
    expect(await drain()).toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
    expect(await jobs()).toHaveLength(0);
  });

  it("RACE: an upload completing while its submission is deleted ends consistent (no attached file without object, no orphan object)", async () => {
    const { e, p } = await individual();
    for (let round = 0; round < 8; round++) {
      await saveDraft(p.actor, e.id, input()).catch(() => undefined); // make sure a submission exists
      const sub = await getDb().submission.findFirstOrThrow({ where: { eventId: e.id } });
      const out = await prepareDirectUpload(p.actor, e.id, { name: "r.pdf", declaredMime: "application/pdf", size: PDF.length });
      mem.objects.set(out.key, PDF);
      await Promise.allSettled([
        completeDirectUpload(p.actor, e.id, { key: out.key, name: "r.pdf", declaredMime: "application/pdf" }),
        getDb().submission.delete({ where: { id: sub.id } }),
      ]);
      await drain(1000);
      // let the ledger reap an upload whose completion lost the race (its submission no longer exists)
      await sweepAbandonedUploads(getDb(), { now: new Date(Date.now() + 5 * 3_600_000) });
      await drain(2000);
      expect(await getDb().submissionFile.count({ where: { storageKey: out.key } }), `round ${round}`).toBe(0);
      expect(mem.objects.has(out.key), `round ${round}: object must be gone with its submission`).toBe(false);
      expect(await jobs()).toHaveLength(0);
    }
  }, 90_000);

  it("a pending upload whose submission was deleted is reaped by the ledger sweep and its object removed", async () => {
    const { e, p } = await individual();
    const out = await prepareDirectUpload(p.actor, e.id, { name: "r.pdf", declaredMime: "application/pdf", size: PDF.length });
    mem.objects.set(out.key, PDF);
    await getDb().submission.deleteMany({ where: { eventId: e.id } });
    await expect(completeDirectUpload(p.actor, e.id, { key: out.key, name: "r.pdf", declaredMime: "application/pdf" })).rejects.toMatchObject({ status: 404 });
    expect(mem.objects.has(out.key)).toBe(true); // not completed, not yet expired
    await sweepAbandonedUploads(getDb(), { now: new Date(Date.now() + 5 * 3_600_000) });
    await drain(1000);
    expect(mem.objects.has(out.key)).toBe(false);
  });

  it("the outbox only ever receives server-side keys: the maintenance code path has no client input", async () => {
    // keys reach the outbox from triggers (database values) and from the upload service (server-generated); the drain API accepts no URL or body
    const keys = (await getDb().$queryRaw<{ n: number }[]>`select count(*)::int n from storage_deletions`)[0].n;
    expect(keys).toBe(0);
  });
});
