import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { addEventHost } from "@/server/modules/admin/admin-management.service";
import { hostSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  const { organizationId, role } = await readJson(req, hostSchema);
  await addEventHost(actor, await uuidParam(ctx, "id", "Event"), organizationId, role);
  return Response.json({ status: "ok" }, { status: 201 });
});
