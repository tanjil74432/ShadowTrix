-- Manual rollback for migration 20261120090000_admin_panel (NOT part of the Prisma migration history).
-- Run only if the migration must be undone; it drops the columns this migration added, so any review or announcement
-- audience data entered after the migration is lost. Afterwards delete the row from _prisma_migrations for this migration.
BEGIN;
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_review_note_required";
DROP INDEX IF EXISTS "events_review_status_idx";
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_reviewed_by_id_fkey";
ALTER TABLE "events" DROP COLUMN IF EXISTS "review_status", DROP COLUMN IF EXISTS "review_note", DROP COLUMN IF EXISTS "reviewed_at", DROP COLUMN IF EXISTS "reviewed_by_id";
ALTER TABLE "announcements" DROP CONSTRAINT IF EXISTS "announcements_updated_by_id_fkey";
ALTER TABLE "announcements" DROP COLUMN IF EXISTS "audience", DROP COLUMN IF EXISTS "updated_at", DROP COLUMN IF EXISTS "updated_by_id";
DROP TYPE IF EXISTS "EventReviewStatus";
DROP TYPE IF EXISTS "AnnouncementAudience";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261120090000_admin_panel';
COMMIT;
