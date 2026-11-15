-- Milestone 5: integrity rules for event management. Additive; no existing data is changed (no events or
-- registrations exist yet, and the constraints only describe rows the application already writes).

-- URL-safe slugs only (lowercase words joined by single hyphens).
ALTER TABLE "events" ADD CONSTRAINT "events_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- A registration is cancelled exactly when it has a cancellation time.
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_cancelled_consistency_chk"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

-- Public listing and the organizer dashboard filter published events by start date and category.
CREATE INDEX "events_status_category_starts_idx" ON "events"("status", "category", "starts_at");

-- Waitlist promotion reads the oldest waitlisted registration of an event.
CREATE INDEX "registrations_event_status_registered_idx" ON "registrations"("event_id", "status", "registered_at");

-- "Events I organize" on the organizer dashboard.
CREATE INDEX "event_organizers_user_idx" ON "event_organizers"("user_id");
