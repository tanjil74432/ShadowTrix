import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { getCertificatePdf } from "@/server/modules/certificates/certificates.service";

/** The recipient (while valid) and the event's organizers. Generated on demand from the stored data. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  const { bytes, fileName } = await getCertificatePdf(actor, await uuidParam(ctx, "certificateId", "Certificate"));
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
