import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { publishResults } from "@/server/modules/results/results.service";

/** Refused with 409 `results_incomplete` unless every submission has finalized scorecards from every judge. */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await publishResults(actor, await eventId(ctx)));
});
