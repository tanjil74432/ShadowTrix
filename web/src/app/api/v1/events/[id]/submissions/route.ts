import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listEventSubmissions } from "@/server/modules/submissions/submissions.service";

/** Organizers of this event (and administrators): every submission with its authors' names, no emails. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listEventSubmissions(actor, await eventId(ctx)) });
});
