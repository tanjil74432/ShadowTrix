import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiPermission, requireApiUser } from "@/server/modules/auth/dal";
import { cancelRegistration, listEventRegistrations, registerForEvent } from "@/server/modules/events/registrations.service";

const query = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED"]).optional(),
});

/** Participant list. Only the organizers of this event (and administrators); names and emails are private data. */
export const GET = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listEventRegistrations(actor, await eventId(ctx), q));
});

/** Register the signed-in user. Idempotent. 201 when a new registration was made, 200 when one already existed. */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("event:register");
  const result = await registerForEvent(actor, await eventId(ctx));
  return Response.json({ status: result.status }, { status: result.created ? 201 : 200 });
});

/** Cancel the signed-in user's own registration. */
export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  const result = await cancelRegistration(actor, await eventId(ctx));
  return Response.json({ status: "ok", cancelled: result.cancelled });
});
