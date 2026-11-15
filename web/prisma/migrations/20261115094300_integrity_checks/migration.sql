-- Integrity rules that Prisma's schema language cannot express.

-- Users / invitations: emails are stored lower-cased so the UNIQUE index is case-insensitive.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_email_lowercase_chk" CHECK ("invitee_email" = lower("invitee_email"));

-- Events: coherent dates, capacity, and team-size rules.
ALTER TABLE "events" ADD CONSTRAINT "events_dates_chk" CHECK ("ends_at" > "starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_registration_window_chk"
  CHECK ("registration_closes_at" >= "registration_opens_at" AND "registration_closes_at" <= "ends_at");
ALTER TABLE "events" ADD CONSTRAINT "events_submission_deadline_chk"
  CHECK ("submission_deadline" IS NULL OR "submission_deadline" >= "starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_chk" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "events" ADD CONSTRAINT "events_team_size_chk" CHECK (
  ("registration_mode" = 'INDIVIDUAL')
  OR ("min_team_size" IS NOT NULL AND "max_team_size" IS NOT NULL
      AND "min_team_size" >= 1 AND "max_team_size" >= "min_team_size")
);

-- Judging: positive criteria, non-negative scores (upper bound enforced by trigger below).
ALTER TABLE "judging_criteria" ADD CONSTRAINT "judging_criteria_positive_chk" CHECK ("max_score" > 0 AND "weight" > 0);
ALTER TABLE "scores" ADD CONSTRAINT "scores_nonneg_chk" CHECK ("score" >= 0);
ALTER TABLE "results" ADD CONSTRAINT "results_nonneg_chk" CHECK ("final_score" >= 0 AND ("rank" IS NULL OR "rank" >= 1));
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_size_chk" CHECK ("size_bytes" >= 0);

CREATE FUNCTION "scores_within_max"() RETURNS trigger AS $$
DECLARE max_allowed numeric;
BEGIN
  SELECT "max_score" INTO max_allowed FROM "judging_criteria" WHERE "id" = NEW."criterion_id";
  IF NEW."score" > max_allowed THEN
    RAISE EXCEPTION 'score % exceeds criterion max %', NEW."score", max_allowed USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "scores_within_max_trg" BEFORE INSERT OR UPDATE OF "score", "criterion_id" ON "scores"
  FOR EACH ROW EXECUTE FUNCTION "scores_within_max"();

-- Organization chronology.
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_dates_chk"
  CHECK ("ended_on" IS NULL OR "started_on" IS NULL OR "ended_on" >= "started_on");
ALTER TABLE "org_terms" ADD CONSTRAINT "org_terms_dates_chk" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

-- Partial unique indexes (uniqueness with NULL-able / conditional columns).
-- Exactly one platform operator organization.
CREATE UNIQUE INDEX "organizations_single_operator_idx" ON "organizations" ("is_operator") WHERE "is_operator";
-- At most one current leadership term.
CREATE UNIQUE INDEX "org_terms_single_current_idx" ON "org_terms" ("is_current") WHERE "is_current";
-- Exactly one LEADER per team.
CREATE UNIQUE INDEX "team_members_single_leader_idx" ON "team_members" ("team_id") WHERE "role" = 'LEADER';
-- Role grants: NULL scope columns are distinct in Postgres, so enforce per scope.
CREATE UNIQUE INDEX "user_roles_global_idx" ON "user_roles" ("user_id", "role")
  WHERE "event_id" IS NULL AND "organization_id" IS NULL;
CREATE UNIQUE INDEX "user_roles_event_idx" ON "user_roles" ("user_id", "role", "event_id")
  WHERE "event_id" IS NOT NULL AND "organization_id" IS NULL;
CREATE UNIQUE INDEX "user_roles_org_idx" ON "user_roles" ("user_id", "role", "organization_id")
  WHERE "organization_id" IS NOT NULL AND "event_id" IS NULL;
-- Public pages list published members by unit; speed that path.
CREATE INDEX "org_members_public_idx" ON "org_members" ("visibility", "status");
