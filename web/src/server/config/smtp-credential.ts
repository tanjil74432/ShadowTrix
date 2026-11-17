import "server-only";

const GMAIL_HOST = /^smtp\.(gmail|googlemail)\.com$/i;

/**
 * Cleans a credential pasted into a hosting dashboard: surrounding whitespace, a trailing newline and one pair of wrapping quotes are never part
 * of the value. For Gmail the app password is shown by Google in four groups separated by spaces, and the spaces are not part of it either.
 */
export function cleanSmtpCredential(raw: string | undefined, opts: { host?: string; secret?: boolean } = {}): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  if (opts.secret && GMAIL_HOST.test((opts.host ?? "").trim())) v = v.replace(/\s+/g, "");
  return v === "" ? undefined : v;
}

export const isGmailHost = (host: string | undefined): boolean => GMAIL_HOST.test((host ?? "").trim());
