import { apiHandler, readJson } from "@/server/http/handler";
import { eventId, uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { criterionUpdateSchema } from "@/server/modules/judging/judging.schema";
import { deleteCriterion, updateCriterion } from "@/server/modules/judging/judging.service";

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  await updateCriterion(actor, await eventId(ctx), await uuidParam(ctx, "criterionId", "Criterion"), await readJson(req, criterionUpdateSchema));
  return Response.json({ status: "ok" });
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await deleteCriterion(actor, await eventId(ctx), await uuidParam(ctx, "criterionId", "Criterion"));
  return Response.json({ status: "ok" });
});
