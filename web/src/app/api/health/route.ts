import { apiHandler } from "@/server/http/handler";
import { checkHealth } from "@/server/modules/health/health.service";

export const GET = apiHandler(async () => {
  const report = await checkHealth();
  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
});
