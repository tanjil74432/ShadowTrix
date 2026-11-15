import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { registerSchema } from "@/server/modules/auth/auth.schema";
import { registerUser } from "@/server/modules/auth/auth.service";

/** Identical response whether or not the address already has an account (no enumeration). */
export const POST = apiHandler(async (req) => {
  const input = await readJson(req, registerSchema);
  await registerUser(input, requestContext(req));
  return Response.json(
    { status: "ok", message: "If this email address can be used, we have sent a message to confirm it." },
    { status: 202 },
  );
});
