-- CreateEnum
CREATE TYPE "StorageDeletionReason" AS ENUM ('FILE_DELETED', 'PHOTO_DELETED', 'CERTIFICATE_DELETED', 'UPLOAD_EXPIRED', 'UPLOAD_REJECTED');

-- CreateTable
CREATE TABLE "storage_deletions" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "reason" "StorageDeletionReason" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error_code" TEXT,

    CONSTRAINT "storage_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_deletions_storage_key_key" ON "storage_deletions"("storage_key");

-- CreateIndex
CREATE INDEX "storage_deletions_next_attempt_at_idx" ON "storage_deletions"("next_attempt_at");

-- Integrity: attempts never go negative.
ALTER TABLE "storage_deletions" ADD CONSTRAINT "storage_deletions_attempts_nonnegative" CHECK ("attempts" >= 0);

-- Durable outbox writer. Runs inside the transaction of the statement that removes the owning row, including rows removed by
-- ON DELETE CASCADE (team disbanding, event or submission deletion, administrator tooling). If that transaction rolls back, the
-- job rolls back with it; if it commits, the job exists. Duplicate keys collapse. It performs no network call.
CREATE FUNCTION enqueue_storage_deletion() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'submission_files' THEN
    INSERT INTO storage_deletions (id, storage_key, reason) VALUES (gen_random_uuid(), OLD.storage_key, 'FILE_DELETED') ON CONFLICT (storage_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'org_members' THEN
    IF OLD.photo_key IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.photo_key IS DISTINCT FROM OLD.photo_key) THEN
      INSERT INTO storage_deletions (id, storage_key, reason) VALUES (gen_random_uuid(), OLD.photo_key, 'PHOTO_DELETED') ON CONFLICT (storage_key) DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME = 'certificates' THEN
    IF OLD.storage_key IS NOT NULL THEN
      INSERT INTO storage_deletions (id, storage_key, reason) VALUES (gen_random_uuid(), OLD.storage_key, 'CERTIFICATE_DELETED') ON CONFLICT (storage_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_files_enqueue_storage_deletion AFTER DELETE ON "submission_files"
  FOR EACH ROW EXECUTE FUNCTION enqueue_storage_deletion();
CREATE TRIGGER org_members_enqueue_storage_deletion AFTER DELETE OR UPDATE OF "photo_key" ON "org_members"
  FOR EACH ROW EXECUTE FUNCTION enqueue_storage_deletion();
CREATE TRIGGER certificates_enqueue_storage_deletion AFTER DELETE ON "certificates"
  FOR EACH ROW EXECUTE FUNCTION enqueue_storage_deletion();
