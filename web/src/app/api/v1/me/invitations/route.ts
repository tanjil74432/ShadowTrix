import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listMyInvitations } from "@/server/modules/teams/teams.service";

/** Open team invitations addressed to the signed-in user's (verified) email. */
export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json({ items: await listMyInvitations(user) });
});
