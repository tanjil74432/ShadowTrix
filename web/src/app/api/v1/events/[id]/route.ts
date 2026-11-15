import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { updateEventSchema } from "@/server/modules/events/event.schema";
import { loadManagedEvent, updateEvent } from "@/server/modules/events/events.service";

/** The organizer view of one event (includes drafts). Only people who manage this event. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  const { organizers: _organizers, createdById: _createdBy, ...event } = await loadManagedEvent(actor, await eventId(ctx));
  void _organizers;
  void _createdBy;
  return Response.json(event);
});

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const input = await readJson(req, updateEventSchema);
  const event = await updateEvent(actor, await eventId(ctx), input);
  return Response.json({ id: event.id, slug: event.slug, status: event.status });
});
