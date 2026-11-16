import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { criterionSchema } from "@/server/modules/judging/judging.schema";
import { createCriterion, listCriteria } from "@/server/modules/judging/judging.service";

/** Organizers of the event and its assigned judges. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listCriteria(actor, await eventId(ctx)) });
});

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await createCriterion(actor, await eventId(ctx), await readJson(req, criterionSchema)), { status: 201 });
});
