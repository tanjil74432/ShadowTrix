import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { resetPasswordSchema } from "@/server/modules/auth/auth.schema";
import { resetPassword } from "@/server/modules/auth/auth.service";
import { clearSessionCookie } from "@/server/modules/auth/session-cookie";

export const POST = apiHandler(async (req) => {
  const input = await readJson(req, resetPasswordSchema);
  await resetPassword(input, requestContext(req));
  await clearSessionCookie(); // if this browser held a session, it was revoked server-side; drop the stale cookie too
  return Response.json({ status: "ok" });
});
