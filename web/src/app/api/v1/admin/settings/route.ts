import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { z } from "zod";
import { setSignupsEnabled } from "@/server/modules/admin/admin-management.service";
import { setApprovalRequired } from "@/server/modules/admin/event-review.service";
import { getPlatformConfig } from "@/server/modules/admin/platform-config.service";

/** Read-only platform configuration (secrets are never included, only whether they are configured). */
export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getPlatformConfig(actor));
});

/** Runtime settings: pause or resume new account registration; require administrator approval before organizers publish events. */
export const PATCH = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const body = await readJson(req, z.object({ signupsEnabled: z.boolean().optional(), eventApprovalRequired: z.boolean().optional() }).refine((b) => b.signupsEnabled !== undefined || b.eventApprovalRequired !== undefined, "Nothing to change"));
  if (body.signupsEnabled !== undefined) await setSignupsEnabled(actor, body.signupsEnabled);
  if (body.eventApprovalRequired !== undefined) await setApprovalRequired(actor, body.eventApprovalRequired);
  return Response.json(body);
});

