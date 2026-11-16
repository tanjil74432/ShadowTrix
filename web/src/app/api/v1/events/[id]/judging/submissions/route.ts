import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listAssignedSubmissions } from "@/server/modules/judging/judging.service";

/** The assigned judge's anonymized work list with the state of their own scorecards. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listAssignedSubmissions(actor, await eventId(ctx)) });
});
