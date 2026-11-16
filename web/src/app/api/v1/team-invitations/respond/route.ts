import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { z } from "zod";
import { respondToInvitation } from "@/server/modules/teams/teams.service";

const body = z.union([
  z.object({ token: z.string().trim().min(20).max(200), accept: z.boolean() }),
  z.object({ id: z.uuid(), accept: z.boolean() }),
]);

/** Accept or decline, from the emailed link (token) or the dashboard (id). Only an explicit POST changes anything. */
export const POST = apiHandler(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(req, body);
  const ref = "token" in input ? { token: input.token } : { id: input.id };
  return Response.json(await respondToInvitation(user, ref, input.accept));
});
