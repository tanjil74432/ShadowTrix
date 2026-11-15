-- AlterTable
ALTER TABLE "events" ADD COLUMN     "judging_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "judging_starts_at" TIMESTAMPTZ(3),
ADD COLUMN     "results_announcement_at" TIMESTAMPTZ(3);

-- Timeline ordering: registration -> event -> submission -> judging -> results announcement.
ALTER TABLE "events" ADD CONSTRAINT "events_judging_window_chk"
  CHECK ("judging_starts_at" IS NULL OR "judging_ends_at" IS NULL OR "judging_ends_at" >= "judging_starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_judging_after_submission_chk"
  CHECK ("submission_deadline" IS NULL OR "judging_starts_at" IS NULL OR "judging_starts_at" >= "submission_deadline");
ALTER TABLE "events" ADD CONSTRAINT "events_results_after_judging_chk"
  CHECK ("results_announcement_at" IS NULL OR "judging_ends_at" IS NULL OR "results_announcement_at" >= "judging_ends_at");
