/**
 * Minimal structured logger that refuses to print secrets.
 * Any field whose name looks sensitive is replaced, and string values that look like tokens are masked.
 * Authentication code should log event names and opaque ids only: never passwords, tokens, cookies or emails.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|auth_?secret|hash|session|email|api[-_]?key/i;
const LONG_TOKENISH = /\b[A-Za-z0-9_-]{32,}\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.replace(LONG_TOKENISH, "[redacted]");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return value;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(fields ?? {}) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  /** Pass only the error's name/message, never request bodies. */
  error: (event: string, err?: unknown, fields?: Record<string, unknown>) =>
    emit("error", event, { ...fields, error: err instanceof Error ? `${err.name}: ${err.message}` : undefined }),
};
