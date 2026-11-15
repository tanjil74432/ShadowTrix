import { apiHandler } from "@/server/http/handler";
import { logout } from "@/server/modules/auth/auth.service";
import { getCurrentUser } from "@/server/modules/auth/dal";
import { clearSessionCookie, readSessionToken } from "@/server/modules/auth/session-cookie";

/** Idempotent: always clears the cookie and revokes the session server-side if there is one. */
export const POST = apiHandler(async () => {
  const user = await getCurrentUser();
  await logout(await readSessionToken(), user?.id);
  await clearSessionCookie();
  return Response.json({ status: "ok" });
});
