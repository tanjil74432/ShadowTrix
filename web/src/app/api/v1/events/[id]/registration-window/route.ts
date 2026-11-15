import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { setRegistrationClosed } from "@/server/modules/events/events.service";

/** Close or reopen registration by hand, regardless of the scheduled dates. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { closed } = await readJson(req, z.object({ closed: z.boolean() }));
  const event = await setRegistrationClosed(actor, await eventId(ctx), closed);
  return Response.json({ id: event.id, registrationManuallyClosed: event.registrationManuallyClosed });
});
