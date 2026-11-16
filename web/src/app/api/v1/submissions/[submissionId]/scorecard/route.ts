import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { scorecardSchema } from "@/server/modules/judging/judging.schema";
import { getScorecard, saveScorecard } from "@/server/modules/judging/judging.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await getScorecard(actor, await uuidParam(ctx, "submissionId", "Submission")));
});

/** Save (or finalize with `finalize: true`) the judge's scores. Validated against each criterion's maximum. */
export const PUT = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await saveScorecard(actor, await uuidParam(ctx, "submissionId", "Submission"), await readJson(req, scorecardSchema)));
});
