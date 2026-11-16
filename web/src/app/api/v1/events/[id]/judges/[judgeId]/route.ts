import { apiHandler } from "@/server/http/handler";
import { eventId, uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { unassignJudge } from "@/server/modules/judging/judging.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await unassignJudge(actor, await eventId(ctx), await uuidParam(ctx, "judgeId", "Judge"));
  return Response.json({ status: "ok" });
});
