import { apiHandler } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { verifyCertificate } from "@/server/modules/certificates/certificates.service";
import { enforceRateLimits } from "@/server/security/rate-limit";

/** Public verification. Rate limited per IP (when the IP is trustworthy). Unknown and malformed codes answer identically. */
export const GET = apiHandler(async (req, ctx) => {
  await enforceRateLimits([{ scope: "certificate-verify:ip", id: requestContext(req).ip, policy: { limit: 60, windowSeconds: 60 } }], new Date());
  const result = await verifyCertificate((await ctx.params).code ?? "");
  return Response.json(result, { status: result.status === "NOT_FOUND" ? 404 : 200 });
});
