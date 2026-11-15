import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { apiHandler } from "@/server/http/handler";
import { notFound, unauthorized } from "@/server/http/errors";
import { cleanupNow } from "@/server/modules/maintenance/cleanup.service";

/**
 * Scheduler hook: any free scheduler (cron, a GitHub Actions schedule, a hosting cron feature) can call
 * `POST /api/v1/internal/cleanup` with `Authorization: Bearer <CRON_SECRET>`. Disabled (404) unless CRON_SECRET is set.
 * Not cookie-authenticated, so the browser CSRF check does not apply; the secret is the credential.
 */
export const POST = apiHandler(
  async (req) => {
    const secret = getEnv().CRON_SECRET;
    if (!secret) throw notFound("Resource");
    const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /i, ""));
    const want = Buffer.from(secret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw unauthorized();
    return Response.json(await cleanupNow());
  },
  { csrf: false },
);
