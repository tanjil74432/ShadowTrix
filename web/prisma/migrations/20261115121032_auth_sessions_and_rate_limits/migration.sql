-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules Prisma cannot express.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_count_chk" CHECK ("count" >= 0);
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_expiry_chk" CHECK ("expires_at" > "created_at");

-- A user has at most one live (unused) email-verification token and one live password-reset token.
-- Issuing a new one must first mark the previous as used, so an old emailed link stops working.
CREATE UNIQUE INDEX "auth_tokens_one_live_per_type_idx" ON "auth_tokens" ("user_id", "type")
  WHERE "used_at" IS NULL AND "type" IN ('EMAIL_VERIFY', 'PASSWORD_RESET');
