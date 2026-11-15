import { apiHandler, readJson } from "@/server/http/handler";
import { forbidden } from "@/server/http/errors";
import { requireApiUser } from "@/server/modules/auth/dal";
import { canCreateEvents } from "@/server/modules/authz/permissions";
import { createEventSchema, listEventsQuerySchema } from "@/server/modules/events/event.schema";
import { createEvent, listPublicEvents } from "@/server/modules/events/events.service";

/** Public: published events only, with search and category filter. */
export const GET = apiHandler(async (req) => {
  const q = listEventsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listPublicEvents(q));
});

/** Organizers and administrators. The new event is a draft that belongs to its creator. */
export const POST = apiHandler(async (req) => {
  const actor = await requireApiUser();
  if (!canCreateEvents(actor)) throw forbidden(); // authorize before looking at the body
  const input = await readJson(req, createEventSchema);
  const event = await createEvent(actor, input);
  return Response.json({ id: event.id, slug: event.slug, status: event.status }, { status: 201 });
});
