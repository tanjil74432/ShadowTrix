import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { getPublicResults } from "@/server/modules/results/results.service";

const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Public leaderboard of an event whose results are published; 404 otherwise (unpublished looks like nonexistent). */
export const GET = apiHandler(async (_req, ctx) => {
  const parsed = slug.safeParse((await ctx.params).slug);
  if (!parsed.success) throw notFound("Results");
  const results = await getPublicResults(parsed.data);
  if (!results) throw notFound("Results");
  return Response.json(results);
});
