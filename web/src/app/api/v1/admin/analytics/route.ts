import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { analyticsQuerySchema, getAnalytics } from "@/server/modules/analytics/analytics.service";

/** Platform analytics computed from the database. Query: `from` and `to` (YYYY-MM-DD, at most 366 days). */
export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getAnalytics(actor, analyticsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});

