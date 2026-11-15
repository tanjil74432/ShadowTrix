import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { emailOnlySchema } from "@/server/modules/auth/auth.schema";
import { resendVerification } from "@/server/modules/auth/auth.service";

export const POST = apiHandler(async (req) => {
  const { email } = await readJson(req, emailOnlySchema);
  await resendVerification(email, requestContext(req));
  return Response.json({ status: "ok", message: "If that address has an unconfirmed account, we have sent a new link." }, { status: 202 });
});
