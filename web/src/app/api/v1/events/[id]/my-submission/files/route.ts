import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { AppError } from "@/server/http/errors";
import { assertMultipart } from "@/server/security/csrf";
import { addFile } from "@/server/modules/submissions/submissions.service";
import { MAX_FILE_BYTES } from "@/server/storage/file-validation";

/**
 * Upload one file (multipart/form-data, field "file"). The declared length is checked before the body is read, then the
 * name, extension, MIME type, size and the file's own bytes are validated. Stored privately under a generated key.
 */
export const POST = apiHandler(
  async (req, ctx) => {
    const actor = await requireApiUser();
    assertMultipart(req); // after authentication: anonymous callers always get 401
    const length = Number(req.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0) throw new AppError(411, "length_required", "The upload must declare its size.");
    if (length > MAX_FILE_BYTES + 64 * 1024) throw new AppError(413, "file_too_large", "The file is too large.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError(400, "invalid_upload", "The upload could not be read.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(400, "invalid_upload", "Send the file in a form field named \"file\".");
    const saved = await addFile(actor, await eventId(ctx), { name: file.name, declaredMime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(saved, { status: 201 });
  },
  { multipart: true },
);
