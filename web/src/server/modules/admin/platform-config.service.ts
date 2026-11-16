import "server-only";
import { getEnv } from "@/server/config/env";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password-policy";
import { EVENT_CATEGORY_VALUES } from "@/server/modules/events/event.schema";
import { POLICIES } from "@/server/security/rate-limit";
import { MAX_FILES_PER_SUBMISSION, MAX_FILE_BYTES } from "@/server/storage/file-validation";
import type { Actor } from "@/server/modules/authz/permissions";
import { assertAdmin, getSignupsEnabled } from "./admin-management.service";

/**
 * The read-only platform configuration shown to administrators. Deliberately an allow-list: it contains settings that help
 * run the platform and only the PRESENCE (never the value) of anything secret. Database URL, AUTH_SECRET, SMTP credentials,
 * CRON_SECRET and S3 keys are never returned.
 */
export async function getPlatformConfig(actor: Actor) {
  assertAdmin(actor);
  const env = getEnv();
  return {
    environment: env.NODE_ENV,
    appUrl: env.APP_URL,
    https: env.APP_URL.startsWith("https://"),
    trustProxy: env.TRUST_PROXY,
    sessions: { absoluteDays: env.SESSION_ABSOLUTE_TTL_DAYS, idleDays: env.SESSION_IDLE_TTL_DAYS },
    email: { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.EMAIL_FROM, credentialsConfigured: !!env.SMTP_USER },
    storage: { driver: env.STORAGE_DRIVER, implemented: env.STORAGE_DRIVER === "local" },
    cleanupEndpointEnabled: !!env.CRON_SECRET,
    signupsEnabled: await getSignupsEnabled(),
    eventCategories: [...EVENT_CATEGORY_VALUES],
    policies: {
      passwordLength: { min: PASSWORD_MIN, max: PASSWORD_MAX },
      uploads: { maxFileMegabytes: MAX_FILE_BYTES / 1024 / 1024, maxFilesPerSubmission: MAX_FILES_PER_SUBMISSION },
      rateLimits: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, `${v.limit} per ${v.windowSeconds >= 3600 ? `${v.windowSeconds / 3600} h` : `${v.windowSeconds / 60} min`}`])),
      invitationDays: 7,
      verificationLinkHours: 24,
      resetLinkMinutes: 60,
    },
  };
}
