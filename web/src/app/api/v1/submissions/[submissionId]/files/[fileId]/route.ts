import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { getFileDownloadTarget } from "@/server/modules/submissions/submissions.service";

/**
 * Private download. Authorization is checked on every request; the file is never reachable by a public URL. Served as an
 * attachment with nosniff and a sandboxing CSP so a browser cannot render it in our origin.
 */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  const target = await getFileDownloadTarget(actor, await uuidParam(ctx, "fileId", "File"));
  if ("redirectTo" in target) {
    // Object storage: authorization was checked above; the browser fetches the bytes from a 60-second signed URL.
    return new Response(null, { status: 307, headers: { Location: target.redirectTo, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
  const { bytes, name, mimeType } = target;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
});
