import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { emailOnlySchema } from "@/server/modules/auth/auth.schema";
import { requestPasswordReset } from "@/server/modules/auth/auth.service";

/** Same response for known and unknown addresses. */
export const POST = apiHandler(async (req) => {
  const { email } = await readJson(req, emailOnlySchema);
  await requestPasswordReset(email, requestContext(req));
  return Response.json({ status: "ok", message: "If an account exists for that address, we have sent reset instructions." }, { status: 202 });
});
