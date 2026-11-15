import { apiHandler, readJson } from "@/server/http/handler";
import { requestContext } from "@/server/http/request-context";
import { completeRegistrationSchema } from "@/server/modules/auth/auth.schema";
import { completeRegistration } from "@/server/modules/auth/auth.service";

/** Step 2 of signup: the emailed token plus the name and password chosen by the mailbox owner. */
export const POST = apiHandler(async (req) => {
  const input = await readJson(req, completeRegistrationSchema);
  await completeRegistration(input, requestContext(req));
  return Response.json({ status: "ok" });
});
