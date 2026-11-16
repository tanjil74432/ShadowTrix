/**
 * Builds and checks the PRODUCTION environment file without ever printing a secret. Run from web/:
 *   npx tsx --conditions=react-server scripts/prod-env.mts generate   write web/.env.production.local (git-ignored)
 *   npx tsx --conditions=react-server scripts/prod-env.mts check      validate it with the application's own environment schema
 *
 * Sources: web/.env.neon (pooled database URL), web/.env.storage (Backblaze values), and the existing web/.env.production.local (values
 * you already filled in, such as the Gmail App Password, are kept). Fresh AUTH_SECRET and CRON_SECRET are generated only when missing, and
 * are never copied from development. The development .env is never read. Output lists variable NAMES and OK/problem only.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { parseEnv } from "../src/server/config/env";

const OUT = ".env.production.local";
const cmd = process.argv[2];
if (cmd !== "generate" && cmd !== "check") {
  console.error("usage: prod-env.mts generate|check");
  process.exit(2);
}
const read = (f: string) => (existsSync(f) ? dotenv.parse(readFileSync(f)) : {});

if (cmd === "generate") {
  const neon = read(".env.neon"), storage = read(".env.storage"), prev = read(OUT);
  const secret = () => randomBytes(48).toString("base64url");
  const v: Record<string, string> = {
    DATABASE_URL: neon.NEON_DATABASE_URL_POOLED ?? "",
    APP_URL: prev.APP_URL ?? "https://CHANGE-ME.vercel.app",
    AUTH_SECRET: prev.AUTH_SECRET ?? secret(),
    CRON_SECRET: prev.CRON_SECRET ?? secret(),
    TRUST_PROXY: "true",
    ENABLE_STYLEGUIDE: "false",
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: storage.S3_ENDPOINT ?? "",
    S3_REGION: storage.S3_REGION ?? "",
    S3_BUCKET: storage.S3_BUCKET ?? "",
    S3_ACCESS_KEY_ID: storage.S3_ACCESS_KEY_ID ?? "",
    S3_SECRET_ACCESS_KEY: storage.S3_SECRET_ACCESS_KEY ?? "",
    PENDING_UPLOAD_TTL_MINUTES: prev.PENDING_UPLOAD_TTL_MINUTES ?? "120",
    SMTP_HOST: prev.SMTP_HOST ?? "smtp.gmail.com",
    SMTP_PORT: prev.SMTP_PORT ?? "587",
    SMTP_SECURE: prev.SMTP_SECURE ?? "false",
    SMTP_USER: prev.SMTP_USER ?? "",
    SMTP_PASSWORD: prev.SMTP_PASSWORD ?? "",
    EMAIL_FROM: prev.EMAIL_FROM ?? "",
  };
  const header = "# PRODUCTION environment (git-ignored). Import into the host's environment settings; never commit, never paste into chat.\n# Fill APP_URL, SMTP_USER, SMTP_PASSWORD (a Gmail App Password) and EMAIL_FROM by hand.\n";
  writeFileSync(OUT, header + Object.entries(v).map(([k, x]) => `${k}="${x}"`).join("\n") + "\n", { mode: 0o600 });
  const empty = Object.entries(v).filter(([k, x]) => !x && k !== "S3_REGION").map(([k]) => k);
  console.log(`wrote web/${OUT} with ${Object.keys(v).length} variables (no values shown).`);
  console.log(empty.length ? `still to fill in by you: ${empty.join(", ")}` : "all variables have a value");
}

if (cmd === "check") {
  if (!existsSync(OUT)) { console.error(`STOP: web/${OUT} does not exist; run generate first.`); process.exit(1); }
  const v = read(OUT);
  const problems: string[] = [];
  for (const k of ["DATABASE_URL", "APP_URL", "AUTH_SECRET", "CRON_SECRET", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]) if (!v[k]) problems.push(`${k} is empty`);
  if (/CHANGE-ME/i.test(v.APP_URL ?? "")) problems.push("APP_URL is still the placeholder");
  if (v.DATABASE_URL && !new URL(v.DATABASE_URL).hostname.includes("-pooler")) problems.push("DATABASE_URL is not the pooled Neon host");
  if (v.DATABASE_URL && /localhost|127\.0\.0\.1/.test(v.DATABASE_URL)) problems.push("DATABASE_URL points at a local database");
  if (v.TRUST_PROXY !== "true") problems.push("TRUST_PROXY must be true behind the host's proxy");
  if (v.ENABLE_STYLEGUIDE === "true") problems.push("ENABLE_STYLEGUIDE must be false in production");
  if (v.STORAGE_DRIVER !== "s3") problems.push("STORAGE_DRIVER must be s3");
  try {
    parseEnv({ ...v, NODE_ENV: "production" }); // the application's own validation: https APP_URL, strong AUTH_SECRET, S3 variables, ...
  } catch (e) {
    problems.push(e instanceof Error ? e.message.replace(/^Invalid environment configuration: /, "") : "invalid environment");
  }
  if (problems.length) { console.error("PROBLEMS:\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("production environment OK (names and structure validated; no values shown).");
}
