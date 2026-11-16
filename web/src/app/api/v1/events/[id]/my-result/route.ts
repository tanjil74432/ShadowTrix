import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { getMyResult } from "@/server/modules/results/results.service";

/** The caller's own published result with anonymous feedback, or null. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ result: await getMyResult(actor, await eventId(ctx)) });
});
