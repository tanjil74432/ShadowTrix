import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { removeEventOrganizer } from "@/server/modules/admin/admin-management.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await removeEventOrganizer(actor, await uuidParam(ctx, "id", "Event"), await uuidParam(ctx, "userId", "Organizer"));
  return Response.json({ status: "ok" });
});

