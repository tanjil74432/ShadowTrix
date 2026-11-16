import "server-only";
/**
 * Cleanup of abandoned direct uploads. Free of Next.js imports so the same code runs from the protected HTTP endpoint and from tests.
 *
 * A direct upload leaves a `pending_uploads` row (PENDING) when the signed URL is issued. The row leaves PENDING exactly once:
 *   - the server verified the stored bytes and attached the file          -> COMPLETED (upload service)
 *   - verification failed or the attach was refused                       -> REJECTED  (upload service, deletion queued)
 *   - nobody finished it before `expiresAt`                               -> EXPIRED   (this job, deletion queued)
 * Both the upload service and this job take the row with one conditional UPDATE (`... WHERE status = 'PENDING' ...`), so under any
 * interleaving exactly one of them wins; the loser changes nothing. This job therefore can never queue the deletion of an object that
 * was attached.
 *
 * This job never touches the object store. Claiming a row and queueing the object's deletion in the durable outbox
 * (`storage_deletions`) happen in ONE transaction, so a crash can no longer leave an expired row whose object is forgotten; the
 * outbox worker (`storage-deletion.core.ts`) deletes the object with all its versions and retries failures. Safe to run repeatedly.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { enqueueStorageDeletion } from "./storage-deletion.core";

const DAY_MS = 86_400_000;

export interface UploadSweepOptions {
  now?: Date;
  /** How many expired uploads to handle per run (the rest is picked up by the next run). */
  batchSize?: number;
  /** Resolved rows older than this are deleted from the ledger. */
  keepResolvedDays?: number;
}

export interface UploadSweepResult {
  expired: number;
  skippedAttached: number;
  skippedRaced: number;
  ledgerRowsRemoved: number;
}

export async function sweepAbandonedUploads(db: PrismaClient, opts: UploadSweepOptions = {}): Promise<UploadSweepResult> {
  const now = opts.now ?? new Date();
  const result: UploadSweepResult = { expired: 0, skippedAttached: 0, skippedRaced: 0, ledgerRowsRemoved: 0 };

  const due = await db.pendingUpload.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
    take: opts.batchSize ?? 200,
    select: { id: true, storageKey: true },
  });

  for (const row of due) {
    const outcome = await db.$transaction(async (tx) => {
      // Claim: only one party can move a row out of PENDING. If the upload service completed it a moment ago, this matches nothing.
      const claim = await tx.pendingUpload.updateMany({ where: { id: row.id, status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED", resolvedAt: now } });
      if (claim.count !== 1) return "raced" as const;
      // Defence in depth: an object that a submission file points at is never queued for deletion.
      if (await tx.submissionFile.findUnique({ where: { storageKey: row.storageKey }, select: { id: true } })) {
        await tx.pendingUpload.updateMany({ where: { id: row.id, status: "EXPIRED" }, data: { status: "COMPLETED" } });
        return "attached" as const;
      }
      await enqueueStorageDeletion(tx, row.storageKey, "UPLOAD_EXPIRED");
      return "expired" as const;
    });
    if (outcome === "raced") result.skippedRaced++;
    else if (outcome === "attached") result.skippedAttached++;
    else result.expired++;
  }

  const ledger = await db.pendingUpload.deleteMany({
    where: { status: { not: "PENDING" }, resolvedAt: { lt: new Date(now.getTime() - (opts.keepResolvedDays ?? 30) * DAY_MS) } },
  });
  result.ledgerRowsRemoved = ledger.count;
  return result;
}
