import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { getTemplate, saveTemplate, templateSchema } from "@/server/modules/certificates/certificates.service";

const typeOf = async (ctx: { params: Promise<Record<string, string>> }) => {
  const t = z.enum(["PARTICIPATION", "FINALIST", "WINNER"]).safeParse((await ctx.params).type);
  if (!t.success) throw notFound("Template");
  return t.data;
};

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await getTemplate(actor, await eventId(ctx), await typeOf(ctx)));
});

export const PUT = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  await saveTemplate(actor, await eventId(ctx), await typeOf(ctx), await readJson(req, templateSchema));
  return Response.json({ status: "ok" });
});
