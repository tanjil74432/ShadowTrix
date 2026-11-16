import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { apiHandler } from "@/server/http/handler";
import { notFound, unauthorized } from "@/server/http/errors";
import { cleanupNow, sweepUploadsNow } from "@/server/modules/maintenance/cleanup.service";
import { drainStorageDeletionsNow } from "@/server/modules/maintenance/storage-deletion.service";

/**
 * Scheduler hook: any free scheduler (cron, a GitHub Actions schedule, a hosting cron feature) can call
 * `POST` (or `GET`, for Vercel Cron) `/api/v1/internal/cleanup` with `Authorization: Bearer <CRON_SECRET>`. Disabled (404) unless CRON_SECRET is set.
 * Not cookie-authenticated, so the browser CSRF check does not apply; the secret is the credential.
 */
async function run(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) throw notFound("Resource");
  // The "Bearer " scheme is required: a bare secret in the header is refused.
  const given = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw unauthorized();
  const housekeeping = await cleanupNow();
  const uploads = await sweepUploadsNow(); // 1. expire abandoned uploads and queue their objects
  const storageDeletions = await drainStorageDeletionsNow(); // 2. delete every queued object (all versions), with retry
  return Response.json({ ...housekeeping, uploads, storageDeletions });
}

/** Manual and scheduler calls. */
export const POST = apiHandler(run, { csrf: false });
/** Vercel Cron invokes its jobs with GET (and sends `Authorization: Bearer <CRON_SECRET>`); the same strict secret check applies. */
export const GET = apiHandler(run, { csrf: false });
