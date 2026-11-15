import { AppError } from "@/server/http/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated, state-changing requests. Layered on top of SameSite=Lax cookies:
 *
 *  1. Origin header, when present, must equal our own origin.
 *  2. Otherwise Sec-Fetch-Site must be "same-origin" (browsers always send one of the two on cross-site writes).
 *  3. A request with neither header is rejected: browsers never omit both on a POST, so this only affects
 *     non-browser clients, which must send an Origin header.
 *  4. JSON endpoints additionally require Content-Type: application/json, which a cross-site HTML form cannot send.
 */
export function assertSameOrigin(req: Request, appUrl: string): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;

  const expected = new URL(appUrl).origin;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  if (origin !== null) {
    if (origin !== expected) throw csrfError();
  } else if (fetchSite !== null) {
    if (fetchSite !== "same-origin") throw csrfError();
  } else {
    throw csrfError();
  }
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Methods that carry a body must declare JSON. (DELETE has no body; it is covered by the Origin check and CORS preflight.) */
export function assertJsonContentType(req: Request): void {
  if (!BODY_METHODS.has(req.method.toUpperCase())) return;
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new AppError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
}

function csrfError() {
  return new AppError(403, "csrf_check_failed", "Cross-site request rejected");
}
