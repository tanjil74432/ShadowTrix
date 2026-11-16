import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { reasonSchema } from "@/server/modules/judging/judging.schema";
import { unpublishResults } from "@/server/modules/results/results.service";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { reason } = await readJson(req, reasonSchema);
  await unpublishResults(actor, await eventId(ctx), reason);
  return Response.json({ status: "ok" });
});
