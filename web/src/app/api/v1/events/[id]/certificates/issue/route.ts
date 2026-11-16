import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { issueCertificates } from "@/server/modules/certificates/certificates.service";

/** Only from published, complete results. Safe to repeat: people who already have a certificate are skipped. */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await issueCertificates(actor, await eventId(ctx)));
});
