import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { completeUploadSchema } from "@/server/modules/submissions/submissions.schema";
import { completeDirectUpload } from "@/server/modules/submissions/submissions.service";

/**
 * Step 2 of a direct upload: the server reads the stored object back, runs the full content validation (extension, MIME type,
 * size, magic bytes, UTF-8) and only then attaches it to the caller's own project. Invalid objects are deleted.
 */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const saved = await completeDirectUpload(actor, await eventId(ctx), await readJson(req, completeUploadSchema));
  return Response.json(saved, { status: 201, headers: { "Cache-Control": "no-store" } });
});
