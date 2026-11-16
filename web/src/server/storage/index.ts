import "server-only";
import { getEnv } from "@/server/config/env";
import { createLocalStorage } from "./local-storage";
import { createS3Storage, regionFromEndpoint } from "./s3-storage";
import type { Storage } from "./storage";

let instance: Storage | undefined;
let override: Storage | undefined;

/** Tests inject an in-memory or temporary-directory driver here. */
export function setStorageForTests(storage: Storage | undefined) {
  override = storage;
}

export function getStorage(): Storage {
  if (override) return override;
  if (instance) return instance;
  const env = getEnv();
  if (env.STORAGE_DRIVER === "local") return (instance = createLocalStorage(env.STORAGE_LOCAL_DIR));
  // S3-compatible object storage (Backblaze B2, Cloudflare R2, ...). env.ts already guarantees bucket and keys are set.
  if (!env.S3_ENDPOINT) throw new Error("S3_ENDPOINT is required when STORAGE_DRIVER=s3");
  const region = env.S3_REGION || regionFromEndpoint(env.S3_ENDPOINT);
  if (!region) throw new Error("S3_REGION is required when it cannot be read from S3_ENDPOINT");
  return (instance = createS3Storage({ endpoint: env.S3_ENDPOINT, region, bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! }));
}
