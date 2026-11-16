import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listMyTeams } from "@/server/modules/teams/teams.service";

/** The signed-in user's own teams. */
export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json({ items: await listMyTeams(user.id) });
});
