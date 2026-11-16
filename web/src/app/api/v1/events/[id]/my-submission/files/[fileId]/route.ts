import { apiHandler } from "@/server/http/handler";
import { eventId, uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { deleteFile } from "@/server/modules/submissions/submissions.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await deleteFile(actor, await eventId(ctx), await uuidParam(ctx, "fileId", "File"));
  return Response.json({ status: "ok" });
});
