import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { getSubmission } from "@/server/modules/submissions/submissions.service";

/** Authors, the event's organizers, and assigned judges (submitted work only). Everyone else: 404. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await getSubmission(actor, await uuidParam(ctx, "submissionId", "Submission")));
});
