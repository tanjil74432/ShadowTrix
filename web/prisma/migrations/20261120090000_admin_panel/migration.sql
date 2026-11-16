-- Admin panel: event review state and announcement audience/edit tracking. Additive only; existing rows get safe defaults.
CREATE TYPE "EventReviewStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'ORGANIZERS', 'PARTICIPANTS', 'JUDGES');

ALTER TABLE "events" ADD COLUMN "review_status" "EventReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN "review_note" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "reviewed_by_id" UUID;
ALTER TABLE "events" ADD CONSTRAINT "events_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "events_review_status_idx" ON "events"("review_status");

ALTER TABLE "announcements" ADD COLUMN "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_by_id" UUID;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A rejection or change request must carry a reason.
ALTER TABLE "events" ADD CONSTRAINT "events_review_note_required" CHECK ("review_status" NOT IN ('REJECTED', 'CHANGES_REQUESTED') OR ("review_note" IS NOT NULL AND length(btrim("review_note")) >= 5));
