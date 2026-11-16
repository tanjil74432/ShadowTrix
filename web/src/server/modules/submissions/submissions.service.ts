import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { AppError, conflict, forbidden, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { canManageEvent, hasGlobalRole, type Actor } from "@/server/modules/authz/permissions";
import { lockEvent } from "@/server/modules/events/registrations.service";
import { enforceRateLimits } from "@/server/security/rate-limit";
import { enqueueStorageDeletion } from "@/server/modules/maintenance/storage-deletion.core";
import { drainStorageDeletionsBestEffort } from "@/server/modules/maintenance/storage-deletion.service";
import { getStorage } from "@/server/storage";
import { MAX_FILES_PER_SUBMISSION, MAX_FILE_BYTES, validateUpload, validateUploadMeta } from "@/server/storage/file-validation";
import type { SubmissionInput } from "./submissions.schema";

type Tx = Prisma.TransactionClient;
export const TOTAL_UPLOAD_LIMIT = 25 * 1024 * 1024;

/** The deadline that applies to an event: the explicit submission deadline, otherwise the end of the event. */
export const submissionDeadlineOf = (e: { submissionDeadline: Date | null; endsAt: Date }) => e.submissionDeadline ?? e.endsAt;

// ───────────────────────────── who may submit ─────────────────────────────

/**
 * Resolves the submitting unit of the caller: their confirmed registration (individual events) or their team's confirmed
 * registration (team events). Anyone else cannot create or change a submission.
 */
async function resolveSubmitter(tx: Tx, actor: Actor, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") throw notFound("Event");
  const reg = await tx.registration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } } });
  if (!reg || reg.status !== "CONFIRMED") throw new AppError(403, "not_registered", "Only people with a confirmed registration can submit a project for this event.");
  if (event.registrationMode === "TEAM") {
    if (!reg.teamId) throw new AppError(403, "not_registered", "Only members of a registered team can submit a project for this event.");
    return { event, teamId: reg.teamId as string | null };
  }
  return { event, teamId: null as string | null };
}

async function findOwnSubmission(tx: Tx, eventId: string, actorId: string, teamId: string | null) {
  return tx.submission.findFirst({ where: teamId ? { eventId, teamId } : { eventId, ownerId: actorId, teamId: null }, include: { files: true } });
}

function assertOpen(event: { submissionDeadline: Date | null; endsAt: Date }, now: Date) {
  if (now >= submissionDeadlineOf(event)) throw new AppError(409, "submission_closed", "The submission deadline has passed.");
}

function assertEditable(status: string) {
  if (status === "UNDER_REVIEW" || status === "SCORED") throw new AppError(409, "submission_locked", "Judging has started, so this submission can no longer be changed.");
  if (status === "DISQUALIFIED") throw new AppError(409, "submission_disqualified", "This submission was disqualified.");
}

// ───────────────────────────── draft, submit, resubmit ─────────────────────────────

async function snapshot(tx: Tx, submissionId: string, actorId: string, now: Date) {
  const s = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { files: { orderBy: { createdAt: "asc" } } } });
  const version = s.currentVersion + 1;
  await tx.submissionVersion.create({
    data: {
      submissionId, version, createdById: actorId, createdAt: now,
      snapshot: {
        title: s.title, description: s.description, repoUrl: s.repoUrl, demoUrl: s.demoUrl, extraLinks: s.extraLinks,
        files: s.files.map((f) => ({ id: f.id, name: f.originalName, mime: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256 })),
      },
    },
  });
  await tx.submission.update({ where: { id: submissionId }, data: { currentVersion: version } });
  return version;
}

/** Saves the working draft (not yet visible to judges). Creates it on first save. Team members all share one draft. */
export async function saveDraft(actor: Actor, eventId: string, input: SubmissionInput, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
    assertOpen(event, now);
    const existing = await findOwnSubmission(tx, eventId, actor.id, teamId);
    const data = { title: input.title, description: input.description, repoUrl: input.repoUrl ?? null, demoUrl: input.demoUrl ?? null, extraLinks: input.extraLinks };
    if (!existing) {
      const created = await tx.submission.create({ data: { eventId, ownerId: actor.id, teamId, status: "DRAFT", ...data } });
      await writeAudit({ actorId: actor.id, action: "submission.draft_created", entityType: "submission", entityId: created.id }, tx);
      return created;
    }
    assertEditable(existing.status);
    if (existing.status !== "DRAFT") throw conflict("This project was already submitted. Use resubmit to change it.");
    const updated = await tx.submission.update({ where: { id: existing.id }, data });
    await writeAudit({ actorId: actor.id, action: "submission.draft_saved", entityType: "submission", entityId: existing.id }, tx);
    return updated;
  });
}

/**
 * Submits (first time) or resubmits (any change to a submitted project) and records a version. The project must have a
 * title, a description, and something to look at: a repository link, a demo link, or at least one file. Nothing can be
 * submitted after the deadline, and nothing can change once judging has started.
 */
export async function submitProject(actor: Actor, eventId: string, input: SubmissionInput | null, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
    assertOpen(event, now);
    let sub = await findOwnSubmission(tx, eventId, actor.id, teamId);
    if (!sub && !input) throw new AppError(409, "nothing_to_submit", "Save your project details first.");
    if (sub) assertEditable(sub.status);
    if (input) {
      const data = { title: input.title, description: input.description, repoUrl: input.repoUrl ?? null, demoUrl: input.demoUrl ?? null, extraLinks: input.extraLinks };
      sub = sub
        ? await tx.submission.update({ where: { id: sub.id }, data, include: { files: true } })
        : await tx.submission.create({ data: { eventId, ownerId: actor.id, teamId, status: "DRAFT", ...data }, include: { files: true } });
    }
    const s = sub!;
    if (!s.repoUrl && !s.demoUrl && s.files.length === 0) {
      throw new AppError(400, "submission_incomplete", "Add a repository link, a demo link or at least one file before submitting.");
    }
    const first = s.status === "DRAFT";
    await tx.submission.update({ where: { id: s.id }, data: { status: "SUBMITTED", submittedAt: s.submittedAt ?? now } });
    const version = await snapshot(tx, s.id, actor.id, now);
    await writeAudit({ actorId: actor.id, action: first ? "submission.submitted" : "submission.resubmitted", entityType: "submission", entityId: s.id, after: { version } }, tx);
    return { id: s.id, version, status: "SUBMITTED" as const };
  });
}

// ───────────────────────────── files ─────────────────────────────

/** Validates and stores one file (private, generated key). A change to an already submitted project creates a new version. */
export async function addFile(actor: Actor, eventId: string, upload: { name: string; declaredMime: string; bytes: Uint8Array }, now: Date = new Date()) {
  await enforceRateLimits([{ scope: "submission-upload:user", id: actor.id, policy: { limit: 30, windowSeconds: 3600 } }], now);
  const check = validateUpload(upload);
  if (!check.ok) throw new AppError(400, "invalid_file", check.reason);
  const storage = getStorage();
  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");

  const row = await getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
    assertOpen(event, now);
    let sub = await findOwnSubmission(tx, eventId, actor.id, teamId);
    if (sub) assertEditable(sub.status);
    if (!sub) {
      // Files can be added before the text is written: start an empty-ish draft that the author completes later.
      sub = await tx.submission.create({ data: { eventId, ownerId: actor.id, teamId, status: "DRAFT", title: "Untitled project", description: "(not written yet)" }, include: { files: true } });
    }
    if (sub.files.length >= MAX_FILES_PER_SUBMISSION) throw new AppError(409, "too_many_files", `At most ${MAX_FILES_PER_SUBMISSION} files per project.`);
    if (sub.files.reduce((n, f) => n + f.sizeBytes, 0) + upload.bytes.length > TOTAL_UPLOAD_LIMIT) throw new AppError(409, "uploads_too_large", "The files of one project may total at most 25 MB.");
    const key = `submissions/${sub.id}/${randomUUID()}`;
    await storage.put(key, upload.bytes);
    try {
      const file = await tx.submissionFile.create({
        data: { submissionId: sub.id, storageKey: key, originalName: check.displayName, mimeType: check.mime, sizeBytes: upload.bytes.length, sha256, uploadedById: actor.id },
      });
      if (sub.status === "SUBMITTED") await snapshot(tx, sub.id, actor.id, now);
      await writeAudit({ actorId: actor.id, action: "submission.file_added", entityType: "submission", entityId: sub.id, after: { fileId: file.id, name: check.displayName, sizeBytes: upload.bytes.length } }, tx);
      return file;
    } catch (e) {
      await storage.remove(key); // never leave an orphan if the database refuses
      throw e;
    }
  });
  return { id: row.id, name: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
}

// ───────────────────── direct uploads (object storage) ─────────────────────
// Large files go browser -> bucket through a short-lived signed URL, because serverless hosts cap request bodies (Vercel: 4.5 MB).
// Step 1 (prepareDirectUpload) authorizes and signs. Step 2 (completeDirectUpload) fetches the stored object and runs the SAME
// validation as a normal upload (extension, MIME type, size, magic bytes, UTF-8) before it is attached; an invalid or
// unregistered object is deleted. The bucket never becomes public and the signed URL is bound to one key, one type and one length.

const UPLOAD_URL_SECONDS = 15 * 60;
/** A temporary upload is deleted this long AFTER its signed URL has expired (so the URL can never be reused against a live object). */
const TEMP_DELETE_SLACK_SECONDS = 2 * 60;
/** A permanent object is queued for deletion this long before it is written, and un-queued only when it is attached. */
const COPY_GUARD_SECONDS = 30 * 60;
/**
 * Temporary uploads live under `incoming/`. After validation the server writes the validated bytes to a NEW server-generated key under
 * `submissions/` and attaches only that one, so a signed upload URL (valid up to 15 minutes) can never change an attached file.
 */
const KEY_PATTERN = /^incoming\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

export async function prepareDirectUpload(actor: Actor, eventId: string, meta: { name: string; declaredMime: string; size: number }, now: Date = new Date()) {
  const direct = getStorage().direct;
  if (!direct) throw new AppError(501, "direct_upload_unavailable", "Direct uploads are not enabled; send the file to the server instead.");
  await enforceRateLimits([{ scope: "submission-upload:user", id: actor.id, policy: { limit: 30, windowSeconds: 3600 } }], now);
  const check = validateUploadMeta(meta);
  if (!check.ok) throw new AppError(400, "invalid_file", check.reason);
  const key = await getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
    assertOpen(event, now);
    let sub = await findOwnSubmission(tx, eventId, actor.id, teamId);
    if (sub) assertEditable(sub.status);
    if (!sub) {
      sub = await tx.submission.create({ data: { eventId, ownerId: actor.id, teamId, status: "DRAFT", title: "Untitled project", description: "(not written yet)" }, include: { files: true } });
    }
    if (sub.files.length >= MAX_FILES_PER_SUBMISSION) throw new AppError(409, "too_many_files", `At most ${MAX_FILES_PER_SUBMISSION} files per project.`);
    if (sub.files.reduce((n, f) => n + f.sizeBytes, 0) + meta.size > TOTAL_UPLOAD_LIMIT) throw new AppError(409, "uploads_too_large", "The files of one project may total at most 25 MB.");
    // The ledger row is written in the same transaction that authorized the upload, before any URL exists: every object that can
    // ever appear in the bucket has a row, so the cleanup job can find it if the upload is never completed.
    const key = `incoming/${sub.id}/${randomUUID()}`;
    await tx.pendingUpload.create({
      data: { storageKey: key, submissionId: sub.id, ownerId: actor.id, contentType: check.mime, declaredSize: meta.size, expiresAt: new Date(now.getTime() + getEnv().PENDING_UPLOAD_TTL_MINUTES * 60_000) },
    });
    return key;
  });
  const signed = await direct.presignPut(key, { contentType: check.mime, size: meta.size, expiresSeconds: UPLOAD_URL_SECONDS });
  return { key, url: signed.url, headers: signed.headers, expiresInSeconds: UPLOAD_URL_SECONDS };
}

export async function completeDirectUpload(actor: Actor, eventId: string, input: { key: string; name: string; declaredMime: string }, now: Date = new Date()) {
  const storage = getStorage();
  if (!storage.direct) throw new AppError(501, "direct_upload_unavailable", "Direct uploads are not enabled.");
  await enforceRateLimits([{ scope: "submission-complete:user", id: actor.id, policy: { limit: 60, windowSeconds: 3600 } }], now);
  const match = KEY_PATTERN.exec(input.key);
  if (!match) throw notFound("Upload");
  const [, keySubmissionId] = match;
  // The key must be inside the caller's own submission folder. Anything else looks like "not found", never "forbidden".
  const own = await getDb().$transaction(async (tx) => {
    const { teamId } = await resolveSubmitter(tx, actor, eventId);
    return findOwnSubmission(tx, eventId, actor.id, teamId);
  });
  if (!own || own.id !== keySubmissionId) throw notFound("Upload");

  // The key must have been issued by step 1 to this very person, and still be PENDING (not completed, rejected or reaped).
  const pending = await getDb().pendingUpload.findUnique({ where: { storageKey: input.key } });
  if (!pending || pending.ownerId !== actor.id || pending.submissionId !== own.id) throw notFound("Upload");
  if (pending.status === "EXPIRED") throw new AppError(410, "upload_expired", "This upload expired. Choose the file again.");
  if (pending.status !== "PENDING") throw new AppError(409, "already_attached", "This upload was already handled.");
  /**
   * Leaves PENDING as REJECTED (only if still PENDING) and queues the object's deletion in the SAME transaction, then deletes it now if
   * possible. If the cleanup job won the row, it queued the deletion itself. A storage failure leaves the durable job for the worker.
   */
  const reject = async () => {
    const won = await getDb().$transaction(async (tx) => {
      const claim = await tx.pendingUpload.updateMany({ where: { id: pending.id, status: "PENDING" }, data: { status: "REJECTED", resolvedAt: now } });
      if (claim.count === 1) await enqueueStorageDeletion(tx, input.key, "UPLOAD_REJECTED");
      return claim.count === 1;
    });
    if (won) await drainStorageDeletionsBestEffort([input.key]);
  };

  const head = await storage.direct.head(input.key);
  if (!head) throw notFound("Upload");
  if (head.size > MAX_FILE_BYTES) {
    await reject();
    throw new AppError(400, "invalid_file", "The file is larger than 10 MB.");
  }
  const stored = await storage.get(input.key);
  if (!stored) throw notFound("Upload");
  const check = validateUpload({ name: input.name, declaredMime: input.declaredMime, bytes: stored.bytes });
  if (!check.ok) {
    await reject(); // never keep an object that failed validation
    throw new AppError(400, "invalid_file", check.reason);
  }
  const sha256 = createHash("sha256").update(stored.bytes).digest("hex");

  // Immutable copy. 1) Queue the new permanent key for deletion FIRST (delayed); it is un-queued only inside the transaction that attaches
  // it, so a crash or failure at any later point can never leave an untracked permanent object. 2) Write exactly the validated bytes.
  const finalKey = `submissions/${keySubmissionId}/${randomUUID()}`;
  await enqueueStorageDeletion(getDb(), finalKey, "UPLOAD_REJECTED", new Date(Date.now() + COPY_GUARD_SECONDS * 1000));
  /** The permanent key was not attached: make its guard job due now and delete it (a missing object is fine). */
  const releaseFinal = async () => {
    await getDb().storageDeletion.updateMany({ where: { storageKey: finalKey }, data: { nextAttemptAt: new Date() } });
    await drainStorageDeletionsBestEffort([finalKey]);
  };
  try {
    await storage.put(finalKey, stored.bytes);
  } catch {
    await releaseFinal();
    throw new AppError(503, "storage_unavailable", "The file could not be stored. Please try again.");
  }

  let registered = false;
  try {
    const row = await getDb().$transaction(async (tx) => {
      await lockEvent(tx, eventId);
      const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
      assertOpen(event, now);
      const sub = await findOwnSubmission(tx, eventId, actor.id, teamId);
      if (!sub || sub.id !== keySubmissionId) throw notFound("Upload");
      assertEditable(sub.status);
      if (sub.files.length >= MAX_FILES_PER_SUBMISSION) throw new AppError(409, "too_many_files", `At most ${MAX_FILES_PER_SUBMISSION} files per project.`);
      if (sub.files.reduce((n, f) => n + f.sizeBytes, 0) + stored.bytes.length > TOTAL_UPLOAD_LIMIT) throw new AppError(409, "uploads_too_large", "The files of one project may total at most 25 MB.");
      // The race with the cleanup job is decided here, atomically: only one conditional UPDATE can move the row out of PENDING.
      // Winning it commits together with the file row; losing it means the job reaped the upload first (and deletes the object).
      const claim = await tx.pendingUpload.updateMany({ where: { id: pending.id, status: "PENDING", expiresAt: { gt: now } }, data: { status: "COMPLETED", resolvedAt: now } });
      if (claim.count !== 1) {
        registered = true; // the temporary object is not ours to delete: the cleanup job (or an earlier completion) owns it now
        const current = await tx.pendingUpload.findUnique({ where: { id: pending.id }, select: { status: true } });
        if (current?.status === "COMPLETED") throw new AppError(409, "already_attached", "This upload was already attached.");
        throw new AppError(410, "upload_expired", "This upload expired. Choose the file again.");
      }
      // Attach ONLY the immutable key, un-queue its guard, and queue the temporary key for deletion after its signed URL has expired.
      await tx.storageDeletion.deleteMany({ where: { storageKey: finalKey } });
      await enqueueStorageDeletion(tx, input.key, "UPLOAD_EXPIRED", new Date(Math.max(now.getTime(), pending.createdAt.getTime() + (UPLOAD_URL_SECONDS + TEMP_DELETE_SLACK_SECONDS) * 1000)));
      const file = await tx.submissionFile.create({
        data: { submissionId: sub.id, storageKey: finalKey, originalName: check.displayName, mimeType: check.mime, sizeBytes: stored.bytes.length, sha256, uploadedById: actor.id },
      });
      if (sub.status === "SUBMITTED") await snapshot(tx, sub.id, actor.id, now);
      await writeAudit({ actorId: actor.id, action: "submission.file_added", entityType: "submission", entityId: sub.id, after: { fileId: file.id, name: check.displayName, sizeBytes: stored.bytes.length } }, tx);
      return file;
    });
    return { id: row.id, name: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
  } catch (e) {
    await releaseFinal(); // nothing was attached: the permanent copy goes (it is not referenced by any row)
    if (!registered) await reject(); // the database refused: reject the row and delete the temporary object too
    throw e;
  }
}

export async function deleteFile(actor: Actor, eventId: string, fileId: string, now: Date = new Date()) {
  const removedKey = await getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const { event, teamId } = await resolveSubmitter(tx, actor, eventId);
    assertOpen(event, now);
    const sub = await findOwnSubmission(tx, eventId, actor.id, teamId);
    const file = sub?.files.find((f) => f.id === fileId);
    if (!sub || !file) throw notFound("File");
    assertEditable(sub.status);
    if (sub.status === "SUBMITTED" && !sub.repoUrl && !sub.demoUrl && sub.files.length === 1) {
      throw new AppError(409, "submission_incomplete", "A submitted project needs a link or a file. Add a link first.");
    }
    await tx.submissionFile.delete({ where: { id: fileId } });
    if (sub.status === "SUBMITTED") await snapshot(tx, sub.id, actor.id, now);
    await writeAudit({ actorId: actor.id, action: "submission.file_removed", entityType: "submission", entityId: sub.id, after: { fileId } }, tx);
    return file.storageKey;
  });
  // The database trigger queued this object's deletion in the transaction above; delete it now (a failure leaves the job for the worker).
  await drainStorageDeletionsBestEffort([removedKey]);
}

// ───────────────────────────── reading ─────────────────────────────

/** Who may open a submission or its files. Judges only see work that was actually submitted, for events they are assigned to. */
async function authorizeRead(actor: Actor, submissionId: string) {
  const db = getDb();
  const sub = await db.submission.findUnique({
    where: { id: submissionId },
    include: { event: { select: { id: true, status: true, organizers: { select: { userId: true } } } }, team: { select: { name: true, members: { select: { userId: true } } } } },
  });
  if (!sub) throw notFound("Submission");
  const isAuthor = sub.ownerId === actor.id || (sub.team?.members.some((m) => m.userId === actor.id) ?? false);
  const isOrganizer = canManageEvent(actor, sub.eventId, sub.event.organizers.map((o) => o.userId));
  let isJudge = false;
  if (!isAuthor && !isOrganizer && sub.status !== "DRAFT") {
    isJudge = !!(await db.judgeAssignment.findUnique({ where: { eventId_judgeId: { eventId: sub.eventId, judgeId: actor.id } } }));
  }
  if (!isAuthor && !isOrganizer && !isJudge && !hasGlobalRole(actor, "ADMIN")) throw notFound("Submission"); // existence is not revealed
  return { sub, isAuthor, isOrganizer, isJudge };
}

const VIEW = {
  id: true, eventId: true, title: true, description: true, repoUrl: true, demoUrl: true, extraLinks: true, status: true, submittedAt: true, currentVersion: true, updatedAt: true,
  files: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" as const } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.SubmissionSelect;

export async function getSubmission(actor: Actor, submissionId: string) {
  const { sub } = await authorizeRead(actor, submissionId);
  return getDb().submission.findUniqueOrThrow({ where: { id: sub.id }, select: VIEW });
}

/** The caller's own submission for an event (their team's, for team events), or null. */
export async function getMySubmission(actor: Actor, eventId: string) {
  const db = getDb();
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } }, select: { teamId: true, status: true } });
  if (!reg || reg.status === "CANCELLED") return null;
  return db.submission.findFirst({ where: reg.teamId ? { eventId, teamId: reg.teamId } : { eventId, ownerId: actor.id, teamId: null }, select: VIEW });
}

export async function listVersions(actor: Actor, submissionId: string) {
  const { sub, isJudge } = await authorizeRead(actor, submissionId);
  if (isJudge) throw forbidden(); // judges score the current version; the history is for authors and organizers
  return getDb().submissionVersion.findMany({
    where: { submissionId: sub.id },
    orderBy: { version: "desc" },
    select: { version: true, snapshot: true, createdAt: true, createdBy: { select: { fullName: true } } },
  });
}

/** Private file download. The caller must be allowed to read the submission; the bytes come from the storage driver. */
export async function getFileForDownload(actor: Actor, fileId: string) {
  const file = await getDb().submissionFile.findUnique({ where: { id: fileId }, select: { id: true, submissionId: true, storageKey: true, originalName: true, mimeType: true } });
  if (!file) throw notFound("File");
  await authorizeRead(actor, file.submissionId);
  const stored = await getStorage().get(file.storageKey);
  if (!stored) throw notFound("File");
  return { bytes: stored.bytes, name: file.originalName, mimeType: file.mimeType };
}

/**
 * Download target for a file the caller may read. Object storage: a 60-second signed URL that forces a download (the app
 * never buffers the file, so the host's response-size limit does not apply). Local driver: the bytes.
 */
export async function getFileDownloadTarget(actor: Actor, fileId: string): Promise<{ redirectTo: string } | { bytes: Uint8Array; name: string; mimeType: string }> {
  const storage = getStorage();
  if (!storage.direct) return getFileForDownload(actor, fileId);
  const file = await getDb().submissionFile.findUnique({ where: { id: fileId }, select: { submissionId: true, storageKey: true, originalName: true, mimeType: true } });
  if (!file) throw notFound("File");
  await authorizeRead(actor, file.submissionId);
  const ascii = file.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
  return { redirectTo: await storage.direct.presignGet(file.storageKey, { contentType: file.mimeType, disposition, expiresSeconds: 60 }) };
}

/** Organizer view of every submission of an event they manage. Authors' names are shown; emails are not. */
export async function listEventSubmissions(actor: Actor, eventId: string) {
  const db = getDb();
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, status: true, organizers: { select: { userId: true } } } });
  if (!event) throw notFound("Event");
  if (!canManageEvent(actor, event.id, event.organizers.map((o) => o.userId))) {
    if (event.status === "DRAFT" || event.status === "ARCHIVED") throw notFound("Event");
    throw forbidden();
  }
  return db.submission.findMany({
    where: { eventId },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, status: true, submittedAt: true, currentVersion: true, team: { select: { name: true } }, owner: { select: { fullName: true } }, _count: { select: { files: true } } },
  });
}

/** Organizer disqualification (before results are published). The reason is recorded. */
export async function disqualifySubmission(actor: Actor, submissionId: string, reason: string) {
  return getDb().$transaction(async (tx) => {
    const sub = await tx.submission.findUnique({ where: { id: submissionId }, include: { event: { select: { resultsPublishedAt: true, organizers: { select: { userId: true } } } } } });
    if (!sub) throw notFound("Submission");
    if (!canManageEvent(actor, sub.eventId, sub.event.organizers.map((o) => o.userId))) throw notFound("Submission");
    if (sub.event.resultsPublishedAt) throw conflict("Results are published, so this submission can no longer be disqualified. Unpublish the results first.");
    if (sub.status === "DISQUALIFIED") return;
    await tx.submission.update({ where: { id: submissionId }, data: { status: "DISQUALIFIED" } });
    await writeAudit({ actorId: actor.id, action: "submission.disqualified", entityType: "submission", entityId: submissionId, before: { status: sub.status }, after: { reason: reason.slice(0, 500) } }, tx);
  });
}
