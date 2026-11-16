import "server-only";
/**
 * Durable storage-deletion outbox: enqueue and drain. Free of Next.js and of any storage SDK (the object store is passed in), so
 * the same code runs from the protected HTTP endpoint, from services (best effort, right after a commit) and from tests.
 *
 * Guarantees
 *  - A job row is written in the SAME transaction as the change that orphans the object (database trigger or `enqueueStorageDeletion`
 *    with the transaction client). Rollback removes it; commit keeps it. No network call ever happens inside a transaction.
 *  - `drainStorageDeletions` claims rows with `FOR UPDATE SKIP LOCKED` and a lease (`locked_until`): two workers never take the same
 *    row, and a crashed worker's rows become claimable again when the lease ends.
 *  - The object is deleted (all versions) first and the row is deleted only afterwards. A failure keeps the row, with exponential
 *    backoff. Deleting twice is harmless (a missing object is not an error), so every step is idempotent and retryable.
 *  - Keys come only from the database (triggers and server code), never from a client. Before deleting, the job is dropped (and the
 *    object kept) if any live row still references the key.
 *  - Nothing sensitive is logged or stored: only counts, an attempt number and a short error code.
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type StorageDeletionReason = "FILE_DELETED" | "PHOTO_DELETED" | "CERTIFICATE_DELETED" | "UPLOAD_EXPIRED" | "UPLOAD_REJECTED";

/** A PrismaClient or an interactive-transaction client: anything with the `storageDeletion` delegate. */
export type OutboxDb = Pick<PrismaClient, "storageDeletion">;

export interface ObjectStore {
  /** Removes the object and all of its versions. Missing objects are not an error. */
  remove(key: string): Promise<void>;
}

export interface DrainOptions {
  now?: Date;
  batchSize?: number;
  leaseSeconds?: number;
  /** Only these keys (used right after a commit to delete the objects that commit orphaned). */
  keys?: readonly string[];
}

export interface DrainResult {
  claimed: number;
  deleted: number;
  skippedInUse: number;
  failed: number;
}

/**
 * Queues an object for deletion. `notBefore` delays the job (used to delete a temporary upload only after its signed URL has expired).
 * Reasons: UPLOAD_EXPIRED = a temporary upload key that is no longer needed (expired, or replaced by an immutable copy);
 * UPLOAD_REJECTED = content refused, or an object written but never attached (including a guard queued before a copy).
 */
export async function enqueueStorageDeletion(db: OutboxDb, key: string, reason: StorageDeletionReason, notBefore?: Date): Promise<void> {
  await db.storageDeletion.createMany({ data: [{ storageKey: key, reason, ...(notBefore ? { nextAttemptAt: notBefore } : {}) }], skipDuplicates: true });
}

/** Seconds to wait before retrying after `attempts` failed attempts: 1, 2, 4 ... capped at 6 hours. */
export const backoffSeconds = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1) * 60, 6 * 3600);

function errorCode(e: unknown): string {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return `HTTP_${status}`;
  return e instanceof Error ? e.name.slice(0, 40) : "ERROR";
}

export async function drainStorageDeletions(db: PrismaClient, store: ObjectStore, opts: DrainOptions = {}): Promise<DrainResult> {
  const now = opts.now ?? new Date();
  const lease = new Date(now.getTime() + (opts.leaseSeconds ?? 300) * 1000);
  const keysFilter = opts.keys ? Prisma.sql`AND storage_key = ANY(${[...opts.keys]}::text[])` : Prisma.empty;
  const claimed = await db.$queryRaw<{ id: string; storage_key: string; attempts: number }[]>`
    UPDATE storage_deletions SET locked_until = ${lease}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM storage_deletions
      WHERE next_attempt_at <= ${now} AND (locked_until IS NULL OR locked_until < ${now}) ${keysFilter}
      ORDER BY next_attempt_at
      LIMIT ${opts.batchSize ?? 50}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, storage_key, attempts`;

  const result: DrainResult = { claimed: claimed.length, deleted: 0, skippedInUse: 0, failed: 0 };
  for (const job of claimed) {
    // Never delete an object that a live row still points at (an attached file, a member photo, a certificate).
    const inUse =
      (await db.submissionFile.findUnique({ where: { storageKey: job.storage_key }, select: { id: true } })) ??
      (await db.orgMember.findFirst({ where: { photoKey: job.storage_key }, select: { id: true } })) ??
      (await db.certificate.findFirst({ where: { storageKey: job.storage_key }, select: { id: true } }));
    if (inUse) {
      await db.storageDeletion.deleteMany({ where: { id: job.id } });
      result.skippedInUse++;
      continue;
    }
    try {
      await store.remove(job.storage_key);
      await db.storageDeletion.deleteMany({ where: { id: job.id } }); // only after the object is gone
      result.deleted++;
    } catch (e) {
      await db.storageDeletion.updateMany({
        where: { id: job.id },
        data: { lockedUntil: null, nextAttemptAt: new Date(now.getTime() + backoffSeconds(job.attempts) * 1000), lastErrorCode: errorCode(e) },
      });
      result.failed++;
    }
  }
  return result;
}

/** Several bounded batches in one run (the maintenance endpoint), stopping early when a batch comes back short. */
export async function drainStorageDeletionsAll(db: PrismaClient, store: ObjectStore, opts: DrainOptions & { maxBatches?: number } = {}): Promise<DrainResult & { batches: number }> {
  const total = { claimed: 0, deleted: 0, skippedInUse: 0, failed: 0, batches: 0 };
  const size = opts.batchSize ?? 50;
  for (let i = 0; i < (opts.maxBatches ?? 4); i++) {
    const r = await drainStorageDeletions(db, store, opts);
    total.batches++;
    total.claimed += r.claimed; total.deleted += r.deleted; total.skippedInUse += r.skippedInUse; total.failed += r.failed;
    if (r.claimed < size || r.failed > 0) break; // done, or the store is failing: leave the rest for the next run
  }
  return total;
}
