import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { beginMfaEnrollment } from "@/server/modules/auth/mfa.service";

/** Administrators only, optional. Returns the secret once so it can be added to an authenticator app. */
export const POST = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json(await beginMfaEnrollment(user, user.email));
});
