-- Milestones 9 and 10: administration and analytics support. Additive.

-- Organization verification (administrators record when an organization's identity was checked, and by whom).
ALTER TABLE "organizations" ADD COLUMN "verified_at" TIMESTAMPTZ(3), ADD COLUMN "verified_by_id" UUID;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Profile photos of leadership members are kept in private-by-default storage; this is the storage key.
ALTER TABLE "org_members" ADD COLUMN "photo_key" TEXT;

-- Indexes that the audit viewer and the analytics queries justify (see docs/operations/performance.md for the measurements).
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX "users_created_at_idx" ON "users"("created_at");
CREATE INDEX "registrations_registered_at_idx" ON "registrations"("registered_at");
