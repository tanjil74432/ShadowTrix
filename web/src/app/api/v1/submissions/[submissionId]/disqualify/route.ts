import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { reasonSchema } from "@/server/modules/judging/judging.schema";
import { disqualifySubmission } from "@/server/modules/submissions/submissions.service";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { reason } = await readJson(req, reasonSchema);
  await disqualifySubmission(actor, await uuidParam(ctx, "submissionId", "Submission"), reason);
  return Response.json({ status: "ok" });
});
