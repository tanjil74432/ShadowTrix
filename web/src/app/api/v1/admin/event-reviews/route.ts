import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { listEventReviews, reviewQuerySchema } from "@/server/modules/admin/event-review.service";

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await listEventReviews(actor, reviewQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});
