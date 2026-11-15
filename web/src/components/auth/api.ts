/** Tiny typed fetch helper for the auth forms (same-origin, JSON, cookies handled by the browser). */
export interface ApiResult {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  fieldErrors: Record<string, string>;
  retryAfterSeconds?: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string; issues?: { path: (string | number)[]; message: string }[] };
}

export async function sendJson(url: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "We could not reach the server. Check your connection and try again.", fieldErrors: {} };
  }
  if (res.ok) return { ok: true, status: res.status, fieldErrors: {} };

  let data: ErrorBody = {};
  try {
    data = (await res.json()) as ErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const fieldErrors: Record<string, string> = {};
  for (const issue of data.error?.issues ?? []) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const retry = Number(res.headers.get("Retry-After"));
  return {
    ok: false,
    status: res.status,
    code: data.error?.code,
    message: data.error?.message ?? "Something went wrong. Please try again.",
    fieldErrors,
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  };
}

export function rateLimitMessage(seconds?: number): string {
  if (!seconds) return "Too many attempts. Please wait a moment and try again.";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "Too many attempts. Please wait a minute and try again." : `Too many attempts. Please try again in about ${minutes} minutes.`;
}
