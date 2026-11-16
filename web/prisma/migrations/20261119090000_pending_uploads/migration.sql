-- CreateEnum
CREATE TYPE "PendingUploadStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "pending_uploads" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "submission_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "declared_size" INTEGER NOT NULL,
    "status" "PendingUploadStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "pending_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_uploads_storage_key_key" ON "pending_uploads"("storage_key");

-- CreateIndex
CREATE INDEX "pending_uploads_status_expires_idx" ON "pending_uploads"("status", "expires_at");

-- CreateIndex
CREATE INDEX "pending_uploads_owner_id_idx" ON "pending_uploads"("owner_id");

-- Integrity rules (hand-written, like the other CHECK constraints):
--  * an upload URL never outlives its record, and the declared size respects the 10 MB limit
--  * a row is "resolved" (has a resolved_at) exactly when it is no longer PENDING
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_declared_size_range" CHECK ("declared_size" > 0 AND "declared_size" <= 10485760);
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_resolved_matches_status" CHECK (("status" = 'PENDING') = ("resolved_at" IS NULL));
