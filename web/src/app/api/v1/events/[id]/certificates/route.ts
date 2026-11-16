import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listEventCertificates } from "@/server/modules/certificates/certificates.service";

/** Issuance history for the event's organizers. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ items: await listEventCertificates(actor, await eventId(ctx)) });
});
