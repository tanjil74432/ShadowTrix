import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { disableMfa } from "@/server/modules/auth/mfa.service";

export const POST = apiHandler(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(
    req,
    z.object({ password: z.string().min(1, "Enter your password.").max(128), code: z.string().trim().min(6, "Enter a code.").max(20) }),
  );
  await disableMfa(user, input);
  return Response.json({ status: "ok" });
});
