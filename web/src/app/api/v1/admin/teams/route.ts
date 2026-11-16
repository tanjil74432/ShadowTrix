import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { listAdminTeams, teamsQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await listAdminTeams(actor, teamsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});
