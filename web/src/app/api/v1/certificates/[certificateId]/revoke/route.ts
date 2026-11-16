import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { revokeCertificate } from "@/server/modules/certificates/certificates.service";
import { reasonSchema } from "@/server/modules/judging/judging.schema";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { reason } = await readJson(req, reasonSchema);
  await revokeCertificate(actor, await uuidParam(ctx, "certificateId", "Certificate"), reason);
  return Response.json({ status: "ok" });
});
