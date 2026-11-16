import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getEventForReview, reviewEvent, reviewSchema } from "@/server/modules/admin/event-review.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getEventForReview(actor, await uuidParam(ctx, "id", "Event")));
});

/** Approve, reject or request changes on a submitted event. A reason is mandatory for the last two. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await reviewEvent(actor, await uuidParam(ctx, "id", "Event"), await readJson(req, reviewSchema));
  return Response.json({ status: "ok" });
});
