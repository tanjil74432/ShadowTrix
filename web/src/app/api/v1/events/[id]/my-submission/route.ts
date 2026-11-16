import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { submissionSchema } from "@/server/modules/submissions/submissions.schema";
import { getMySubmission, saveDraft } from "@/server/modules/submissions/submissions.service";

/** The caller's own submission (their team's, for team events), or null. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ submission: await getMySubmission(actor, await eventId(ctx)) });
});

/** Save the working draft. Only people with a confirmed registration. */
export const PUT = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const s = await saveDraft(actor, await eventId(ctx), await readJson(req, submissionSchema));
  return Response.json({ id: s.id, status: s.status });
});
