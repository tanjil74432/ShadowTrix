import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { confirmMfaEnrollment } from "@/server/modules/auth/mfa.service";

export const POST = apiHandler(async (req) => {
  const user = await requireApiUser();
  const { code } = await readJson(req, z.object({ code: z.string().trim().min(6, "Enter the 6-digit code.").max(10) }));
  return Response.json(await confirmMfaEnrollment(user, code));
});
