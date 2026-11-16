import "server-only";
import { getDb } from "@/server/db/client";
import { log } from "@/server/logging/logger";
import { runCleanup, type CleanupOptions } from "./cleanup.core";
import { sweepAbandonedUploads, type UploadSweepOptions } from "./upload-sweep.core";

export const cleanupNow = (opts?: CleanupOptions) => runCleanup(getDb(), opts);

/** Expires abandoned direct uploads and queues their objects for deletion (no storage call). Logs counts only: never keys, URLs or credentials. */
export async function sweepUploadsNow(opts?: UploadSweepOptions) {
  const result = await sweepAbandonedUploads(getDb(), opts);
  if (result.expired || result.skippedAttached) log.info("uploads.sweep", { ...result });
  return result;
}
