import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getJudgingEvent } from "@/server/modules/admin/admin-ops.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getJudgingEvent(actor, await uuidParam(ctx, "id", "Event")));
});
