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
    AUTH_SECRET: z.string().min(32).optional(), // required from Milestone 4 (auth)

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
    if (env.NODE_ENV === "production" && !env.AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "AUTH_SECRET is required in production" });
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
