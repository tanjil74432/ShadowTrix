import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { z } from "zod";
import { reasonSchema } from "@/server/modules/judging/judging.schema";
import { reopenScorecard } from "@/server/modules/judging/judging.service";

/** An organizer reopens one judge's finalized scorecard (before results are published). */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { judgeId, reason } = await readJson(req, reasonSchema.extend({ judgeId: z.uuid() }));
  await reopenScorecard(actor, await uuidParam(ctx, "submissionId", "Submission"), judgeId, reason);
  return Response.json({ status: "ok" });
});
