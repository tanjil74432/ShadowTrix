import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { adminEventsQuerySchema, listAllEvents } from "@/server/modules/admin/admin-management.service";

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await listAllEvents(actor, adminEventsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});
