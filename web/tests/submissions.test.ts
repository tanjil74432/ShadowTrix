import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { submissionSchema } from "@/server/modules/submissions/submissions.schema";
import {
  addFile, deleteFile, disqualifySubmission, getFileForDownload, getMySubmission, getSubmission, listEventSubmissions, listVersions, saveDraft, submitProject,
} from "@/server/modules/submissions/submissions.service";
import { registerTeam } from "@/server/modules/teams/teams.service";
import { setStorageForTests } from "@/server/storage";
import { createLocalStorage } from "@/server/storage/local-storage";
import { ALLOWED_EXTENSIONS, MAX_FILE_BYTES, sanitizeFileName, validateUpload } from "@/server/storage/file-validation";
import { assertSafeKey } from "@/server/storage/storage";
import { actorOf, cleanup, createUser, makeHarness, tokenFrom } from "./helpers/auth-harness";
import { DAY, iso, organizer, participant, publishedEvent, teamEvent } from "./helpers/event-fixtures";
import { createTeam, inviteMember, respondToInvitation } from "@/server/modules/teams/teams.service";
import { createTeamSchema } from "@/server/modules/teams/teams.schema";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "st-test-storage-"));
  setStorageForTests(createLocalStorage(dir));
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  setStorageForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  await getDb().$disconnect();
});

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const text = (s: string) => new Uint8Array(Buffer.from(s));

const input = (over: Record<string, unknown> = {}) =>
  submissionSchema.parse({ title: "Our project", description: "A description of the project that is long enough.", repoUrl: "https://github.com/example/repo", ...over });

describe("upload validation (pure)", () => {
  it("accepts every allowed type with matching content and declared type", () => {
    expect(validateUpload({ name: "report.pdf", declaredMime: "application/pdf", bytes: PDF })).toMatchObject({ ok: true, mime: "application/pdf", extension: "pdf" });
    expect(validateUpload({ name: "shot.PNG", declaredMime: "image/png", bytes: PNG })).toMatchObject({ ok: true, extension: "png" });
    expect(validateUpload({ name: "photo.jpeg", declaredMime: "image/jpeg", bytes: JPG })).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(validateUpload({ name: "code.zip", declaredMime: "application/x-zip-compressed", bytes: ZIP })).toMatchObject({ ok: true, mime: "application/zip" });
    expect(validateUpload({ name: "notes.txt", declaredMime: "text/plain; charset=utf-8", bytes: text("héllo") })).toMatchObject({ ok: true });
    expect(validateUpload({ name: "README.md", declaredMime: "application/octet-stream", bytes: text("# Title") })).toMatchObject({ ok: true, mime: "text/markdown" });
  });

  it("rejects disallowed extensions, double extensions and executables", () => {
    for (const name of ["run.exe", "script.js", "page.html", "image.svg", "archive.tar.gz", "doc.pdf.exe", "noextension", ".pdf", "evil.php", "a.sh"]) {
      expect(validateUpload({ name, declaredMime: "application/pdf", bytes: PDF }), name).toMatchObject({ ok: false });
    }
  });

  it("rejects content that does not match the extension or the declared type (a renamed file)", () => {
    expect(validateUpload({ name: "fake.pdf", declaredMime: "application/pdf", bytes: text("<html>not a pdf</html>") })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "fake.png", declaredMime: "image/png", bytes: JPG })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "fake.zip", declaredMime: "application/zip", bytes: PDF })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "real.pdf", declaredMime: "image/png", bytes: PDF })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not match/) });
    expect(validateUpload({ name: "bin.txt", declaredMime: "text/plain", bytes: bytes(0x41, 0x00, 0x42) })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "latin.txt", declaredMime: "text/plain", bytes: bytes(0xff, 0xfe, 0xfd) })).toMatchObject({ ok: false, reason: expect.stringMatching(/UTF-8/) });
  });

  it("enforces size limits", () => {
    expect(validateUpload({ name: "empty.txt", declaredMime: "text/plain", bytes: new Uint8Array(0) })).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61);
    expect(validateUpload({ name: "big.txt", declaredMime: "text/plain", bytes: big })).toMatchObject({ ok: false, reason: expect.stringMatching(/larger/) });
    expect(validateUpload({ name: "ok.txt", declaredMime: "text/plain", bytes: new Uint8Array(MAX_FILE_BYTES).fill(0x61) })).toMatchObject({ ok: true });
  });

  it("sanitizes names: no path parts, no control characters, bounded", () => {
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("a<b>\u0000\u0007.pdf")).toBe("ab.pdf");
    expect(sanitizeFileName("...hidden.txt")).toBe("hidden.txt");
    expect(sanitizeFileName("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(100);
    expect(sanitizeFileName("")).toBe("file");
    expect(ALLOWED_EXTENSIONS).not.toContain("html");
  });
});

describe("storage (local driver)", () => {
  it("accepts only generated-style keys and refuses traversal and absolute paths", () => {
    for (const ok of ["submissions/abc-123/def-456", "a", "a/b/c"]) expect(() => assertSafeKey(ok), ok).not.toThrow();
    for (const bad of ["../x", "a/../b", "/etc/passwd", "a//b", "a/b.", "A/B", "a\\b", "a/b/c/d/e/f", "", "..", "a/./b", "a b", "%2e%2e/x", "x".repeat(300)]) {
      expect(() => assertSafeKey(bad), bad).toThrow();
    }
  });

  it("stores, reads and removes objects; never overwrites; missing objects are null", async () => {
    const s = createLocalStorage(dir);
    await s.put("tests/one", text("hello"));
    expect(Buffer.from((await s.get("tests/one"))!.bytes).toString()).toBe("hello");
    await expect(s.put("tests/one", text("again"))).rejects.toThrow();
    await s.remove("tests/one");
    await s.remove("tests/one");
    expect(await s.get("tests/one")).toBeNull();
    await expect(s.get("../escape")).rejects.toThrow();
    await expect(s.put("../escape", text("x"))).rejects.toThrow();
  });
});

describe("submission input", () => {
  it("accepts https links only and limits hosts for the repository", () => {
    expect(submissionSchema.safeParse({ title: "Good title", description: "x".repeat(30), repoUrl: "https://github.com/a/b", demoUrl: "https://demo.example.com", extraLinks: ["https://docs.example.com/a"] }).success).toBe(true);
    for (const bad of ["http://github.com/a/b", "javascript:alert(1)", "https://user:pass@github.com/a/b", "ftp://x.com/y", "data:text/html,hi", "github.com/a/b", "https://evil.example/a/b"]) {
      expect(submissionSchema.safeParse({ title: "Good title", description: "x".repeat(30), repoUrl: bad }).success, bad).toBe(false);
    }
    expect(submissionSchema.safeParse({ title: "Good title", description: "x".repeat(30), demoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(submissionSchema.safeParse({ title: "Good title", description: "x".repeat(30), extraLinks: Array(6).fill("https://a.example.com") }).success).toBe(false);
    expect(submissionSchema.safeParse({ title: "ab", description: "x".repeat(30) }).success).toBe(false);
    expect(submissionSchema.safeParse({ title: "Good title", description: "short" }).success).toBe(false);
  });
});

/** An individual event whose submission deadline is in the future, with a confirmed participant. */
async function individualSetup() {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const p = await participant();
  await registerForEvent(p.actor, e.id);
  return { o, e, p };
}

describe("creating, submitting and resubmitting", () => {
  it("only people with a confirmed registration can submit", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8), capacity: 1 });
    const confirmed = await participant();
    const waitlisted = await participant();
    const stranger = await participant();
    await registerForEvent(confirmed.actor, e.id);
    await registerForEvent(waitlisted.actor, e.id);
    for (const who of [waitlisted, stranger]) {
      await expect(saveDraft(who.actor, e.id, input())).rejects.toMatchObject({ code: "not_registered" });
      await expect(submitProject(who.actor, e.id, input())).rejects.toMatchObject({ code: "not_registered" });
    }
    await expect(saveDraft(confirmed.actor, e.id, input())).resolves.toMatchObject({ status: "DRAFT" });
    const draftEvent = await (await import("@/server/modules/events/events.service")).createEvent(o.actor, (await import("./helpers/event-fixtures")).eventInput());
    await expect(saveDraft(confirmed.actor, draftEvent.id, input())).rejects.toMatchObject({ status: 404 });
  });

  it("a draft is private, submitting creates version 1 and judges-visible status, resubmitting adds versions with history", async () => {
    const { e, p, o } = await individualSetup();
    const draft = await saveDraft(p.actor, e.id, input({ title: "First title" }));
    expect(draft.status).toBe("DRAFT");
    expect(draft.submittedAt).toBeNull();
    expect(await getDb().submissionVersion.count({ where: { submissionId: draft.id } })).toBe(0);
    await expect(saveDraft(p.actor, e.id, input({ title: "Edited draft" }))).resolves.toMatchObject({ id: draft.id, title: "Edited draft" });

    expect(await submitProject(p.actor, e.id, null)).toMatchObject({ version: 1, status: "SUBMITTED" });
    const after = await getDb().submission.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after).toMatchObject({ status: "SUBMITTED", currentVersion: 1 });
    expect(after.submittedAt).not.toBeNull();

    await expect(saveDraft(p.actor, e.id, input())).rejects.toMatchObject({ status: 409 }); // already submitted: use resubmit
    expect(await submitProject(p.actor, e.id, input({ title: "Second title", demoUrl: "https://demo.example.com" }))).toMatchObject({ version: 2 });
    const history = await listVersions(p.actor, draft.id);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect((history[1].snapshot as { title: string }).title).toBe("Edited draft");
    expect((history[0].snapshot as { title: string }).title).toBe("Second title");
    expect(await getDb().auditLog.count({ where: { entityId: draft.id, action: { in: ["submission.draft_created", "submission.submitted", "submission.resubmitted"] } } })).toBe(3);

    // organizers of this event see it; the version history too
    expect((await listEventSubmissions(o.actor, e.id)).map((s) => s.title)).toEqual(["Second title"]);
    await expect(listVersions(o.actor, draft.id)).resolves.toHaveLength(2);
  });

  it("requires something to look at: a link or a file", async () => {
    const { e, p } = await individualSetup();
    await expect(submitProject(p.actor, e.id, input({ repoUrl: null }))).rejects.toMatchObject({ code: "submission_incomplete" });
    await addFile(p.actor, e.id, { name: "write-up.pdf", declaredMime: "application/pdf", bytes: PDF });
    await expect(submitProject(p.actor, e.id, null)).resolves.toMatchObject({ version: 1 });
  });

  it("enforces the deadline (the explicit one, or the event end) for every change", async () => {
    const { e, p } = await individualSetup();
    await saveDraft(p.actor, e.id, input());
    const late = new Date(Date.now() + 9 * DAY);
    await expect(submitProject(p.actor, e.id, null, late)).rejects.toMatchObject({ code: "submission_closed" });
    await expect(saveDraft(p.actor, e.id, input(), late)).rejects.toMatchObject({ code: "submission_closed" });
    await expect(addFile(p.actor, e.id, { name: "a.txt", declaredMime: "text/plain", bytes: text("x") }, late)).rejects.toMatchObject({ code: "submission_closed" });
    // just before the deadline it still works
    await expect(submitProject(p.actor, e.id, null, new Date(Date.now() + 7.9 * DAY))).resolves.toBeDefined();

    // without an explicit deadline the end of the event applies
    const o = await organizer();
    const e2 = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(3), registrationClosesAt: iso(2) });
    const q = await participant();
    await registerForEvent(q.actor, e2.id);
    await expect(submitProject(q.actor, e2.id, input(), new Date(Date.now() + 2.9 * DAY))).resolves.toBeDefined();
    await expect(submitProject(q.actor, e2.id, input(), new Date(Date.now() + 3.1 * DAY))).rejects.toMatchObject({ code: "submission_closed" });
  });

  it("is locked once judging starts or the submission is disqualified", async () => {
    const { e, p, o } = await individualSetup();
    const { id } = await submitProject(p.actor, e.id, input());
    await getDb().submission.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
    await expect(submitProject(p.actor, e.id, input({ title: "Late edit" }))).rejects.toMatchObject({ code: "submission_locked" });
    await getDb().submission.update({ where: { id }, data: { status: "SUBMITTED" } });
    await disqualifySubmission(o.actor, id, "plagiarism");
    await expect(submitProject(p.actor, e.id, input({ title: "Late edit" }))).rejects.toMatchObject({ code: "submission_disqualified" });
    expect(await getDb().auditLog.count({ where: { entityId: id, action: "submission.disqualified" } })).toBe(1);
  });

  it("concurrent resubmissions produce consecutive versions without duplicates", async () => {
    const { e, p } = await individualSetup();
    await submitProject(p.actor, e.id, input());
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => submitProject(p.actor, e.id, input({ title: `Concurrent ${i}` }))));
    expect(results.map((r) => r.version).sort()).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("ownership and access", () => {
  it("other participants cannot read, and organizers of other events cannot either", async () => {
    const { e, p, o } = await individualSetup();
    const { id } = await submitProject(p.actor, e.id, input());
    const stranger = await participant();
    const otherOrg = await organizer();
    await expect(getSubmission(stranger.actor, id)).rejects.toMatchObject({ status: 404 });
    await expect(getSubmission(otherOrg.actor, id)).rejects.toMatchObject({ status: 404 });
    await expect(listEventSubmissions(stranger.actor, e.id)).rejects.toMatchObject({ status: 403 });
    await expect(listEventSubmissions(otherOrg.actor, e.id)).rejects.toMatchObject({ status: 403 });
    await expect(getSubmission(o.actor, id)).resolves.toMatchObject({ title: "Our project" });
    await expect(getSubmission(p.actor, id)).resolves.toMatchObject({ id });
    expect((await getMySubmission(p.actor, e.id))?.id).toBe(id);
    expect(await getMySubmission(stranger.actor, e.id)).toBeNull();
    const admin = await createUser({ roles: ["ADMIN"] });
    await expect(getSubmission(actorOf(admin), id)).resolves.toBeDefined();
  });

  it("an assigned judge sees submitted work only; unassigned judges see nothing", async () => {
    const { e, p } = await individualSetup();
    const judge = await createUser({ roles: ["JUDGE"] });
    const other = await createUser({ roles: ["JUDGE"] });
    const draft = await saveDraft(p.actor, e.id, input());
    await getDb().judgeAssignment.create({ data: { eventId: e.id, judgeId: judge.id } });
    await expect(getSubmission(actorOf(judge), draft.id)).rejects.toMatchObject({ status: 404 }); // still a private draft
    await submitProject(p.actor, e.id, null);
    await expect(getSubmission(actorOf(judge), draft.id)).resolves.toBeDefined();
    await expect(getSubmission(actorOf(other), draft.id)).rejects.toMatchObject({ status: 404 });
    await expect(listVersions(actorOf(judge), draft.id)).rejects.toMatchObject({ status: 403 });
  });

  it("on team events every member shares one submission; non-members and unregistered teams cannot submit", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
    const h = makeHarness();
    const leader = await participant();
    const member = await participant();
    const outsider = await participant();
    const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: `vt sub team ${Date.now().toString(36)}` }));
    await inviteMember(leader.actor, team.id, member.u.email, h.deps);
    await h.flush();
    await respondToInvitation(member.actor, { token: tokenFrom(h.lastMailTo(member.u.email)) }, true);
    await expect(saveDraft(leader.actor, e.id, input())).rejects.toMatchObject({ code: "not_registered" }); // team not registered yet
    await registerTeam(leader.actor, team.id);

    const a = await saveDraft(member.actor, e.id, input({ title: "By the member" }));
    const b = await saveDraft(leader.actor, e.id, input({ title: "By the leader" }));
    expect(b.id).toBe(a.id);
    expect(await getDb().submission.count({ where: { eventId: e.id } })).toBe(1);
    expect((await getMySubmission(member.actor, e.id))?.team?.name).toBe(team.name);
    await expect(saveDraft(outsider.actor, e.id, input())).rejects.toMatchObject({ code: "not_registered" });
    await expect(getSubmission(outsider.actor, a.id)).rejects.toMatchObject({ status: 404 });
    // simultaneous first saves by two members still yield exactly one submission
    await submitProject(leader.actor, e.id, null);
    expect((await getDb().submission.findMany({ where: { eventId: e.id } })).length).toBe(1);
  });

  it("two members saving at the same moment create a single shared submission", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
    const h = makeHarness();
    const leader = await participant();
    const member = await participant();
    const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: `vt race team ${Date.now().toString(36)}` }));
    await inviteMember(leader.actor, team.id, member.u.email, h.deps);
    await h.flush();
    await respondToInvitation(member.actor, { token: tokenFrom(h.lastMailTo(member.u.email)) }, true);
    await registerTeam(leader.actor, team.id);
    await Promise.all([saveDraft(leader.actor, e.id, input()), saveDraft(member.actor, e.id, input({ title: "Other member" }))]);
    expect(await getDb().submission.count({ where: { eventId: e.id } })).toBe(1);
  });
});

describe("files", () => {
  it("stores validated files privately under generated keys, and serves them only to authorized people", async () => {
    const { e, p, o } = await individualSetup();
    const file = await addFile(p.actor, e.id, { name: "../../My Report.pdf", declaredMime: "application/pdf", bytes: PDF });
    expect(file.name).toBe("My Report.pdf");
    const row = await getDb().submissionFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.storageKey).toMatch(/^submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(row.storageKey).not.toContain("Report");
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const mine = await getFileForDownload(p.actor, file.id);
    expect(Buffer.from(mine.bytes).toString().startsWith("%PDF-")).toBe(true);
    expect(mine).toMatchObject({ name: "My Report.pdf", mimeType: "application/pdf" });
    await expect(getFileForDownload(o.actor, file.id)).resolves.toBeDefined();
    await expect(getFileForDownload((await participant()).actor, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(getFileForDownload((await organizer()).actor, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(getFileForDownload(p.actor, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects invalid uploads with a reason, stores nothing, and enforces the file count", async () => {
    const { e, p } = await individualSetup();
    await expect(addFile(p.actor, e.id, { name: "evil.exe", declaredMime: "application/octet-stream", bytes: text("MZ") })).rejects.toMatchObject({ code: "invalid_file" });
    await expect(addFile(p.actor, e.id, { name: "fake.pdf", declaredMime: "application/pdf", bytes: text("not a pdf") })).rejects.toMatchObject({ code: "invalid_file" });
    expect(await getDb().submissionFile.count()).toBe(0);
    for (let i = 0; i < 5; i++) await addFile(p.actor, e.id, { name: `f${i}.txt`, declaredMime: "text/plain", bytes: text(`file ${i}`) });
    await expect(addFile(p.actor, e.id, { name: "six.txt", declaredMime: "text/plain", bytes: text("six") })).rejects.toMatchObject({ code: "too_many_files" });
  });

  it("changing files of a submitted project records a version; deleting removes the stored object", async () => {
    const { e, p } = await individualSetup();
    const { id } = await submitProject(p.actor, e.id, input());
    const f = await addFile(p.actor, e.id, { name: "extra.txt", declaredMime: "text/plain", bytes: text("extra") });
    expect((await getDb().submission.findUniqueOrThrow({ where: { id } })).currentVersion).toBe(2);
    const key = (await getDb().submissionFile.findUniqueOrThrow({ where: { id: f.id } })).storageKey;
    await deleteFile(p.actor, e.id, f.id);
    expect((await getDb().submission.findUniqueOrThrow({ where: { id } })).currentVersion).toBe(3);
    expect(await createLocalStorage(dir).get(key)).toBeNull();
    const versions = await listVersions(p.actor, id);
    expect((versions[1].snapshot as { files: unknown[] }).files).toHaveLength(1);
    expect((versions[0].snapshot as { files: unknown[] }).files).toHaveLength(0);
    await expect(deleteFile(p.actor, e.id, f.id)).rejects.toMatchObject({ status: 404 });
  });

  it("people cannot delete somebody else's files", async () => {
    const { e, p } = await individualSetup();
    const f = await addFile(p.actor, e.id, { name: "mine.txt", declaredMime: "text/plain", bytes: text("mine") });
    const o2 = await participant();
    await registerForEvent(o2.actor, e.id);
    await expect(deleteFile(o2.actor, e.id, f.id)).rejects.toMatchObject({ status: 404 });
    expect(await getDb().submissionFile.count({ where: { id: f.id } })).toBe(1);
  });
});
