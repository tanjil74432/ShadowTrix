import "server-only";
import { getDb } from "@/server/db/client";
import { runCleanup, type CleanupOptions } from "./cleanup.core";

export const cleanupNow = (opts?: CleanupOptions) => runCleanup(getDb(), opts);
