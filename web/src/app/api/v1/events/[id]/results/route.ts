import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { getDraftStandings } from "@/server/modules/results/results.service";

/** Organizer view: standings with completeness, what is missing, and per-judge breakdowns. Never public. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await getDraftStandings(actor, await eventId(ctx)));
});
