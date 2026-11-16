import { getDb } from "@/server/db/client";

/**
 * The upload and storage-deletion tests need empty ledgers (the sweep and the worker look at whole tables; database triggers also queue
 * jobs whenever any test deletes files). Only ever runs against a local database: it refuses anything else, so it can never touch a
 * hosted database by mistake.
 */
export async function resetUploadTables() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://invalid").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("Refusing to reset the upload tables on a non-local database");
  await getDb().pendingUpload.deleteMany({});
  await getDb().storageDeletion.deleteMany({});
}
