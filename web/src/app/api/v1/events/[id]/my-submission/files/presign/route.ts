import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { directUploadSchema } from "@/server/modules/submissions/submissions.schema";
import { prepareDirectUpload } from "@/server/modules/submissions/submissions.service";

/**
 * Step 1 of a direct upload to private object storage: authorizes the caller (confirmed participant, open event, editable
 * project, file and size limits) and returns a short-lived signed URL bound to one key, one content type and one length.
 * Answers 501 when the deployment stores files on local disk; the browser then uses the ordinary upload route.
 */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const out = await prepareDirectUpload(actor, await eventId(ctx), await readJson(req, directUploadSchema));
  return Response.json(out, { status: 201, headers: { "Cache-Control": "no-store" } });
});
