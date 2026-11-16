import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { assignJudgeSchema } from "@/server/modules/judging/judging.schema";
import { assignJudge, listJudges } from "@/server/modules/judging/judging.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listJudges(actor, await eventId(ctx)) });
});

/** Assign an existing, confirmed account as a judge of THIS event. No platform-wide role is granted. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { email } = await readJson(req, assignJudgeSchema);
  const r = await assignJudge(actor, await eventId(ctx), email);
  return Response.json(r, { status: r.created ? 201 : 200 });
});
