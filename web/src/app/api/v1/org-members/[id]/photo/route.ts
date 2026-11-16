import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { getCurrentUser } from "@/server/modules/auth/dal";
import { getMemberPhoto } from "@/server/modules/organization/organization.service";

/** Public for verified, published members; administrators can see any. Everything else is 404. */
export const GET = apiHandler(async (_req, ctx) => {
  const { bytes, mime } = await getMemberPhoto(await getCurrentUser(), await uuidParam(ctx, "id", "Photo"));
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache", "Content-Security-Policy": "sandbox; default-src 'none'" } });
});
