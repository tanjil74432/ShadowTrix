import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { removeEventHost } from "@/server/modules/admin/admin-management.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await removeEventHost(actor, await uuidParam(ctx, "id", "Event"), await uuidParam(ctx, "organizationId", "Organization"));
  return Response.json({ status: "ok" });
});
