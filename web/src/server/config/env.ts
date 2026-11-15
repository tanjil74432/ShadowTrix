import "server-only";
import { z } from "zod";

/**
 * Environment configuration, validated once on first access.
 * Everything deployment-specific (database, email, storage) comes from here so
 * the app stays portable across hosting providers.
 */
const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url().default("http://localhost:3010"),
    // HMAC key for rate-limit keys and token hashing contexts. >= 32 chars; required in production.
    AUTH_SECRET: z.string().min(32).optional(),
    // Set true ONLY behind a reverse proxy that overwrites X-Forwarded-For. Otherwise the header is attacker-controlled.
    TRUST_PROXY: bool,
    SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_IDLE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    // Bearer secret for the scheduler endpoint POST /api/v1/internal/cleanup. Unset = endpoint disabled.
    CRON_SECRET: z.string().min(32).optional(),

    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default("ShadowTrix <no-reply@shadowtrix.local>"),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./.storage"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
      }
    }
    if (env.NODE_ENV === "production") {
      if (!env.AUTH_SECRET) {
        ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "AUTH_SECRET is required in production" });
      } else if (/change-me|dev-only|example/i.test(env.AUTH_SECRET)) {
        ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "AUTH_SECRET looks like a placeholder; generate a real secret" });
      }
      const host = new URL(env.APP_URL).hostname;
      const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      if (!env.APP_URL.startsWith("https://") && !isLocal) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "APP_URL must be https in production (cookies are Secure); only localhost may use http" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable names and messages only; never echo values (they may be secrets).
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** AUTH_SECRET is only needed by auth features; fail with a clear message when it is missing. */
export function getAuthSecret(): string {
  const secret = getEnv().AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set (min 32 characters). See web/.env.example.");
  return secret;
}
