import "server-only";
import { getEnv } from "@/server/config/env";
import { cleanSmtpCredential, isGmailHost } from "@/server/config/smtp-credential";
import { AppError } from "@/server/http/errors";
import { log } from "@/server/logging/logger";

/**
 * Is this deployment able to deliver real email? Pure and secret-free: it reports VARIABLE NAMES that are missing, never values.
 *
 * A mail setup is judged only on a public deployment (production build AND an https APP_URL that is not a local address). Development,
 * CI and the end-to-end tests send to a local sink (Mailpit) on purpose and are always "ready". On a public deployment, a local sink or an
 * incomplete provider configuration would make every verification and reset email vanish, so requests that must send mail are refused up
 * front with a clear 503 instead of pretending to succeed. The refusal is identical for every caller, so it reveals nothing about accounts.
 */
export interface EmailConfigInput {
  appUrl: string;
  nodeEnv: string;
  host: string;
  user?: string;
  password?: string;
  from: string;
}

export interface EmailStatus {
  ready: boolean;
  /** Human-readable problems that name variables only. Safe to log and to show to administrators. */
  problems: string[];
}

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|mailpit|host\.docker\.internal)$/i;
const SENDER = /^(?:[^<>\r\n]*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/;

export function evaluateEmailConfig(c: EmailConfigInput): EmailStatus {
  const url = new URL(c.appUrl);
  const publicDeployment = c.nodeEnv === "production" && url.protocol === "https:" && !LOCAL_HOST.test(url.hostname);
  if (!publicDeployment) return { ready: true, problems: [] };

  const problems: string[] = [];
  if (LOCAL_HOST.test(c.host)) {
    problems.push("SMTP_HOST points at a local mail sink, which delivers nothing outside this server");
  } else {
    if (!c.user) problems.push("SMTP_USER is not set");
    if (!c.password) problems.push("SMTP_PASSWORD is not set");
  }
  const from = c.from.trim();
  if (!SENDER.test(from) || /@shadowtrix\.local>?$/i.test(from)) problems.push("EMAIL_FROM is not set to a real sender address");
  return { ready: problems.length === 0, problems };
}

export function getEmailStatus(): EmailStatus {
  const env = getEnv();
  return evaluateEmailConfig({ appUrl: env.APP_URL, nodeEnv: env.NODE_ENV, host: env.SMTP_HOST, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.EMAIL_FROM });
}

/** Refuses (503) before any account or token is created when email cannot be delivered. The public message names no variable. */
export function assertEmailReady(status: EmailStatus = getEmailStatus()): void {
  if (status.ready) return;
  log.error("email.not_configured", undefined, { problems: status.problems });
  throw new AppError(503, "email_unavailable", "Email delivery is not available right now. Please try again later or contact the administrator.");
}

/**
 * Reduces a mail transport error to a short code. Transport error MESSAGES can echo server responses, addresses or other details, so the
 * message is never logged or stored: only the nodemailer error code (for example EAUTH, ECONNECTION, ETIMEDOUT) and the SMTP reply code.
 */
export function describeMailError(err: unknown): { code: string; responseCode?: number; command?: string } {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  // Whitelist the SHAPE of each field instead of stripping characters: a value that is not exactly an error code or an SMTP verb is dropped whole.
  const code = typeof e.code === "string" && /^[A-Z][A-Z0-9_]{1,23}$/.test(e.code) ? e.code : "UNKNOWN";
  const command = typeof e.command === "string" && /^[A-Z][A-Z ]{1,15}$/.test(e.command) ? e.command : undefined;
  const responseCode = typeof e.responseCode === "number" && Number.isInteger(e.responseCode) && e.responseCode >= 100 && e.responseCode <= 599 ? e.responseCode : undefined;
  return { code, ...(responseCode ? { responseCode } : {}), ...(command ? { command } : {}) };
}

/**
 * Facts about the configured login that explain a provider rejection (SMTP 535) without revealing any value: only booleans and the password
 * length. Safe to store in the audit log and show to administrators.
 */
export interface SmtpCredentialShape {
  userSet: boolean;
  userIsEmailAddress: boolean;
  userMatchesSender: boolean;
  userHadStrayCharacters: boolean;
  passwordSet: boolean;
  passwordLength: number;
  passwordHadStrayCharacters: boolean;
  gmailHost: boolean;
}

export function describeSmtpCredentialShape(raw: { host?: string; user?: string; password?: string; from?: string }): SmtpCredentialShape {
  const host = raw.host ?? "";
  const user = cleanSmtpCredential(raw.user);
  const password = cleanSmtpCredential(raw.password, { host, secret: true });
  const sender = (raw.from ?? "").match(/<([^>]+)>/)?.[1] ?? (raw.from ?? "");
  return {
    userSet: Boolean(user),
    userIsEmailAddress: Boolean(user && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)),
    userMatchesSender: Boolean(user && user.toLowerCase() === sender.trim().toLowerCase()),
    userHadStrayCharacters: raw.user !== undefined && raw.user !== (user ?? ""),
    passwordSet: Boolean(password),
    passwordLength: password?.length ?? 0,
    passwordHadStrayCharacters: raw.password !== undefined && raw.password !== (password ?? ""),
    gmailHost: isGmailHost(host),
  };
}

export function getSmtpCredentialShape(): SmtpCredentialShape {
  return describeSmtpCredentialShape({ host: process.env.SMTP_HOST, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.EMAIL_FROM });
}
