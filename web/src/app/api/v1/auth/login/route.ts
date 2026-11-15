import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { loginSchema } from "@/server/modules/auth/auth.schema";
import { login } from "@/server/modules/auth/auth.service";
import { setSessionCookie } from "@/server/modules/auth/session-cookie";

export const POST = apiHandler(async (req) => {
  const input = await readJson(req, loginSchema);
  const result = await login(input, requestContext(req));
  await setSessionCookie(result.sessionToken);
  // The token travels only in the HttpOnly cookie; it is never returned in the body.
  return Response.json({ user: { id: result.user.id, email: result.user.email, fullName: result.user.fullName } });
});
