import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { recalculateResults } from "@/server/modules/results/results.service";

export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await recalculateResults(actor, await eventId(ctx)));
});
