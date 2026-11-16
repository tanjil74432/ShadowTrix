import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { submitEventForReview } from "@/server/modules/admin/event-review.service";

/** An organizer asks an administrator to review a draft event. Only people who manage this event. */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await submitEventForReview(actor, await eventId(ctx));
  return Response.json({ status: "ok" });
});
