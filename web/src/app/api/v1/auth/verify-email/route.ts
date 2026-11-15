import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { tokenSchema } from "@/server/modules/auth/auth.schema";
import { verifyEmail } from "@/server/modules/auth/auth.service";

export const POST = apiHandler(async (req) => {
  const { token } = await readJson(req, tokenSchema);
  await verifyEmail(token, requestContext(req));
  return Response.json({ status: "ok" });
});
