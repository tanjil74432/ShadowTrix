import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { matrixRendererModuleSource } from "@/server/modules/banner/matrix-renderer";

/**
 * The code that draws the ShadowTrix Matrix design, as an ES module. 401 when anonymous, 403 for everybody who is not an administrator, so
 * nobody else ever receives it. Never cached (the answer depends on who is asking and on the current role).
 */
export const GET = apiHandler(async () => {
  await requireApiPermission("admin:access");
  return new Response(matrixRendererModuleSource(), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
});
