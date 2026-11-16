import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getAdminOverview } from "@/server/modules/admin/admin-ops.service";

export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getAdminOverview(actor));
});
