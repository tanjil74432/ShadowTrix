-- Milestones 7 and 8: teams, submissions with version history, judging finalization, results breakdown, certificate
-- templates and revocation. Additive. Existing tables are empty or only gain columns that are nullable or have
-- defaults; team_members.event_id is backfilled from its team before it becomes NOT NULL.

CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED');

ALTER TABLE "teams" ADD COLUMN "description" TEXT, ADD COLUMN "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE UNIQUE INDEX "teams_id_event_id_key" ON "teams"("id", "event_id");

-- A person belongs to at most ONE team per event, guaranteed by the database. The composite foreign key also proves a
-- membership's event is its team's event.
ALTER TABLE "team_members" ADD COLUMN "event_id" UUID;
UPDATE "team_members" tm SET "event_id" = t."event_id" FROM "teams" t WHERE t."id" = tm."team_id";
ALTER TABLE "team_members" ALTER COLUMN "event_id" SET NOT NULL;
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_team_id_fkey";
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_event_id_fkey"
  FOREIGN KEY ("team_id", "event_id") REFERENCES "teams"("id", "event_id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "team_members_event_id_user_id_key" ON "team_members"("event_id", "user_id");

-- Team size limit enforced where it cannot be bypassed. The trigger locks the team row first, so two simultaneous
-- joins cannot both take the last place.
CREATE FUNCTION "team_members_max_size"() RETURNS trigger AS $$
DECLARE max_size integer; cnt integer;
BEGIN
  PERFORM 1 FROM "teams" WHERE "id" = NEW."team_id" FOR UPDATE;
  SELECT e."max_team_size" INTO max_size FROM "events" e WHERE e."id" = NEW."event_id";
  IF max_size IS NOT NULL THEN
    SELECT count(*) INTO cnt FROM "team_members" WHERE "team_id" = NEW."team_id";
    IF cnt >= max_size THEN
      RAISE EXCEPTION 'team is full (max %)', max_size USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "team_members_max_size_trg" BEFORE INSERT ON "team_members" FOR EACH ROW EXECUTE FUNCTION "team_members_max_size"();

-- One open invitation per team and address.
CREATE UNIQUE INDEX "team_invitations_one_pending_idx" ON "team_invitations"("team_id", "invitee_email") WHERE "status" = 'PENDING';

-- Submissions: extra links, version counter, and the rule that only drafts have no submission time.
ALTER TABLE "submissions" ADD COLUMN "extra_links" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 0;
UPDATE "submissions" SET "extra_links" = ARRAY[]::TEXT[] WHERE "extra_links" IS NULL;
ALTER TABLE "submissions" ALTER COLUMN "extra_links" SET NOT NULL;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_at_chk"
  CHECK ("status" = 'DISQUALIFIED' OR (("status" = 'DRAFT') = ("submitted_at" IS NULL)));

CREATE TABLE "submission_versions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "submission_versions_submission_id_version_key" ON "submission_versions"("submission_id", "version");
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_version_chk" CHECK ("version" >= 1);

ALTER TABLE "submission_files" ADD COLUMN "uploaded_by_id" UUID, ADD COLUMN "sha256" TEXT;
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Judging: a scorecard is final once finalized_at is set on its rows.
ALTER TABLE "scores" ADD COLUMN "finalized_at" TIMESTAMPTZ(3);
CREATE INDEX "scores_submission_id_judge_id_idx" ON "scores"("submission_id", "judge_id");

-- Results: how the final score was derived, and when.
ALTER TABLE "results" ADD COLUMN "breakdown" JSONB, ADD COLUMN "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Certificates.
ALTER TABLE "certificates" ADD COLUMN "revoked_reason" TEXT, ADD COLUMN "issued_by_id" UUID;
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_chk" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL));
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "CertificateType" NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signatory_name" TEXT,
    "signatory_title" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "certificate_templates_event_id_type_key" ON "certificate_templates"("event_id", "type");
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
