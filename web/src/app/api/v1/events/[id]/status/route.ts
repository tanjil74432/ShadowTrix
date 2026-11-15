import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { eventStatusActionSchema } from "@/server/modules/events/event.schema";
import { setEventStatus } from "@/server/modules/events/events.service";

/** Publish, unpublish, cancel or archive. Only people who manage this event. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { action } = await readJson(req, eventStatusActionSchema);
  const event = await setEventStatus(actor, await eventId(ctx), action);
  return Response.json({ id: event.id, status: event.status });
});
