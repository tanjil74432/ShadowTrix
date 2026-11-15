import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { changePasswordSchema } from "@/server/modules/auth/auth.schema";
import { changePassword } from "@/server/modules/auth/auth.service";
import { requireApiUser } from "@/server/modules/auth/dal";
import { setSessionCookie } from "@/server/modules/auth/session-cookie";

/** Signed-in password change. Every other device is signed out; this browser receives a fresh session. */
export const POST = apiHandler(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(req, changePasswordSchema);
  const result = await changePassword({ userId: user.id, ...input }, requestContext(req));
  await setSessionCookie(result.sessionToken);
  return Response.json({ status: "ok" });
});
