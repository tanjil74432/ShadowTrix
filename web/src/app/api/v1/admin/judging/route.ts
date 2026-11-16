import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getJudgingOverview, judgingQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getJudgingOverview(actor, judgingQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});
