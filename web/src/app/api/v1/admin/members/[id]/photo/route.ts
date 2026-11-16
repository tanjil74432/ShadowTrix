import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { AppError } from "@/server/http/errors";
import { assertMultipart } from "@/server/security/csrf";
import * as org from "@/server/modules/organization/organization.service";

/** Upload a profile photo (multipart, field "file"; PNG or JPEG up to 2 MB). */
export const POST = apiHandler(
  async (req, ctx) => {
    const actor = await requireApiPermission("admin:access");
    assertMultipart(req); // after authentication and authorization: callers who may not upload never learn the expected format
    const length = Number(req.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0) throw new AppError(411, "length_required", "The upload must declare its size.");
    if (length > org.MAX_PHOTO_BYTES + 64 * 1024) throw new AppError(413, "file_too_large", "A profile photo can be at most 2 MB.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new AppError(400, "invalid_upload", "Send the photo in a form field named \"file\".");
    await org.setMemberPhoto(actor, await uuidParam(ctx, "id", "Member"), { name: file.name, declaredMime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ status: "ok" }, { status: 201 });
  },
  { multipart: true },
);

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.removeMemberPhoto(actor, await uuidParam(ctx, "id", "Member"));
  return Response.json({ status: "ok" });
});

