/**
 * Best-effort client address for rate limiting.
 *
 * Next.js route handlers do not expose the socket address, so we can only use proxy headers, and those
 * are attacker-controlled unless a trusted reverse proxy overwrites them. Therefore:
 *  - TRUST_PROXY=false (default): returns null; IP-based limits are skipped and per-account limits still apply.
 *  - TRUST_PROXY=true: use the RIGHT-most X-Forwarded-For entry (the one appended by our own proxy), never the
 *    left-most one a client can forge.
 */
export function getClientIp(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const xff = headers.get("x-forwarded-for");
  if (!xff) return headers.get("x-real-ip")?.trim() || null;
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}
