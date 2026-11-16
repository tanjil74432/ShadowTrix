import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { removeMember } from "@/server/modules/teams/teams.service";

/** The leader removes a member. */
export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await removeMember(actor, await uuidParam(ctx, "teamId", "Team"), await uuidParam(ctx, "userId", "Member"));
  return Response.json({ status: "ok" });
});
