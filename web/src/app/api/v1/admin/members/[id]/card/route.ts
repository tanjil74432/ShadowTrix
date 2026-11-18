import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getMemberStyle, saveMemberStyle } from "@/server/modules/organization/leadership-template.service";

/** One member's card style: portrait position and decorative text. Administrators only. */
export const GET = apiHandler(async (_req, ctx) => {
  await requireApiPermission("admin:access");
  return Response.json({ style: await getMemberStyle(await uuidParam(ctx, "id", "Member")) });
});

export const PUT = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return Response.json({ style: await saveMemberStyle(actor, await uuidParam(ctx, "id", "Member"), body) });
});
