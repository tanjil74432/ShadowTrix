import "server-only";
import { getDb } from "@/server/db/client";
import { log } from "@/server/logging/logger";
import { getStorage } from "@/server/storage";
import { drainStorageDeletions, drainStorageDeletionsAll, type DrainOptions } from "./storage-deletion.core";

/** Maintenance run: several bounded batches. Logs counts only (never keys). */
export async function drainStorageDeletionsNow(opts?: DrainOptions & { maxBatches?: number }) {
  const r = await drainStorageDeletionsAll(getDb(), getStorage(), opts);
  if (r.claimed) log.info("storage.deletions", { ...r });
  return r;
}

/**
 * Called right after a commit that orphaned objects (file or member deleted, team disbanded, upload rejected): deletes those objects now
 * so they do not linger until the next maintenance run. Never throws: a failure leaves the durable job queued for the worker.
 */
export async function drainStorageDeletionsBestEffort(keys?: readonly string[]) {
  try {
    await drainStorageDeletions(getDb(), getStorage(), { keys, batchSize: keys ? Math.max(keys.length, 1) : 25 });
  } catch (e) {
    log.error("storage.drain_failed", e);
  }
}
