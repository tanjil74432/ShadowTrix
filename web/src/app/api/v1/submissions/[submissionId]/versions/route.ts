import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listVersions } from "@/server/modules/submissions/submissions.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listVersions(actor, await uuidParam(ctx, "submissionId", "Submission")) });
});
