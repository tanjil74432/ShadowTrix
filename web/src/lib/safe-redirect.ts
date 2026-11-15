/**
 * Validates a post-login redirect target. Only same-site relative paths are allowed, which blocks
 * open-redirect attacks such as ?next=https://evil.example, ?next=//evil.example or ?next=/\evil.example.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  if (next.length > 300) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return fallback;
  } catch {
    return fallback;
  }
  // Never bounce back to the auth pages themselves.
  if (/^\/(login|register|forgot-password|reset-password|verify-email)(\/|\?|$)/.test(next)) return fallback;
  return next;
}
