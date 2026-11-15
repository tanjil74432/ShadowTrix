-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('PARTICIPANT', 'TEAM_LEADER', 'ORGANIZER', 'JUDGE', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'REFRESH');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('PLATFORM_OPERATOR', 'UNIVERSITY', 'COMMUNITY', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "HostRole" AS ENUM ('HOST', 'CO_HOST', 'PARTNER');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('HACKATHON', 'DATATHON', 'AI_ML', 'PROGRAMMING_CONTEST', 'WORKSHOP', 'SUMMIT', 'INNOVATION_CHALLENGE', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('ONLINE', 'ONSITE', 'HYBRID');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SCORED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('WINNER', 'RUNNER_UP', 'FINALIST', 'NONE');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('PARTICIPATION', 'FINALIST', 'WINNER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'FORMER');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "bio" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoleKey" NOT NULL,
    "event_id" UUID,
    "organization_id" UUID,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "website_url" TEXT,
    "logo_url" TEXT,
    "is_operator" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "registration_opens_at" TIMESTAMPTZ(3) NOT NULL,
    "registration_closes_at" TIMESTAMPTZ(3) NOT NULL,
    "submission_deadline" TIMESTAMPTZ(3),
    "registration_manually_closed" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "registration_mode" "RegistrationMode" NOT NULL DEFAULT 'INDIVIDUAL',
    "min_team_size" INTEGER,
    "max_team_size" INTEGER,
    "eligibility" TEXT,
    "location_type" "LocationType" NOT NULL DEFAULT 'ONLINE',
    "location" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "results_published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_hosts" (
    "event_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "HostRole" NOT NULL DEFAULT 'HOST',

    CONSTRAINT "event_hosts_pkey" PRIMARY KEY ("event_id","organization_id")
);

-- CreateTable
CREATE TABLE "event_organizers" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "event_organizers_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "event_schedule_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "author_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "leader_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "invitee_id" UUID,
    "invitee_email" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "attended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "team_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "repo_url" TEXT,
    "demo_url" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "judging_criteria" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "max_score" DECIMAL(6,2) NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "judging_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "judge_assignments" (
    "event_id" UUID NOT NULL,
    "judge_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "judge_assignments_pkey" PRIMARY KEY ("event_id","judge_id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "judge_id" UUID NOT NULL,
    "criterion_id" UUID NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "final_score" DECIMAL(8,3) NOT NULL,
    "rank" INTEGER,
    "award" "AwardType" NOT NULL DEFAULT 'NONE',
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "public_code" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "CertificateType" NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "storage_key" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_units" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "rank_order" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_terms" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "org_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "photo_url" TEXT,
    "bio" TEXT,
    "department" TEXT,
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "portfolio_url" TEXT,
    "email" TEXT,
    "email_public" BOOLEAN NOT NULL DEFAULT false,
    "responsibilities" TEXT,
    "skills" TEXT[],
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "Visibility" NOT NULL DEFAULT 'DRAFT',
    "is_placeholder" BOOLEAN NOT NULL DEFAULT true,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "designation_id" UUID NOT NULL,
    "term_id" UUID,
    "started_on" DATE,
    "ended_on" DATE,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_member_contributions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "event_id" UUID,
    "description" TEXT NOT NULL,

    CONSTRAINT "org_member_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_event_id_organization_id_key" ON "user_roles"("user_id", "role", "event_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_category_idx" ON "events"("category");

-- CreateIndex
CREATE INDEX "event_schedule_items_event_id_starts_at_idx" ON "event_schedule_items"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "announcements_event_id_published_at_idx" ON "announcements"("event_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "teams_event_id_name_key" ON "teams"("event_id", "name");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "team_invitations_team_id_status_idx" ON "team_invitations"("team_id", "status");

-- CreateIndex
CREATE INDEX "team_invitations_invitee_email_idx" ON "team_invitations"("invitee_email");

-- CreateIndex
CREATE INDEX "registrations_event_id_status_idx" ON "registrations"("event_id", "status");

-- CreateIndex
CREATE INDEX "registrations_user_id_idx" ON "registrations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_event_id_user_id_key" ON "registrations"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_team_id_key" ON "submissions"("team_id");

-- CreateIndex
CREATE INDEX "submissions_event_id_status_idx" ON "submissions"("event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_event_id_owner_id_key" ON "submissions"("event_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_storage_key_key" ON "submission_files"("storage_key");

-- CreateIndex
CREATE INDEX "submission_files_submission_id_idx" ON "submission_files"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "judging_criteria_event_id_name_key" ON "judging_criteria"("event_id", "name");

-- CreateIndex
CREATE INDEX "scores_judge_id_idx" ON "scores"("judge_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_submission_id_judge_id_criterion_id_key" ON "scores"("submission_id", "judge_id", "criterion_id");

-- CreateIndex
CREATE UNIQUE INDEX "results_submission_id_key" ON "results"("submission_id");

-- CreateIndex
CREATE INDEX "results_event_id_rank_idx" ON "results"("event_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_public_code_key" ON "certificates"("public_code");

-- CreateIndex
CREATE INDEX "certificates_user_id_idx" ON "certificates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_event_id_user_id_type_key" ON "certificates"("event_id", "user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "org_units_slug_key" ON "org_units"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "designations_title_key" ON "designations"("title");

-- CreateIndex
CREATE UNIQUE INDEX "org_terms_label_key" ON "org_terms"("label");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_slug_key" ON "org_members"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_user_id_key" ON "org_members"("user_id");

-- CreateIndex
CREATE INDEX "org_memberships_unit_id_display_order_idx" ON "org_memberships"("unit_id", "display_order");

-- CreateIndex
CREATE INDEX "org_memberships_member_id_idx" ON "org_memberships"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_member_id_unit_id_designation_id_term_id_key" ON "org_memberships"("member_id", "unit_id", "designation_id", "term_id");

-- CreateIndex
CREATE INDEX "org_member_contributions_member_id_idx" ON "org_member_contributions"("member_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_hosts" ADD CONSTRAINT "event_hosts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_hosts" ADD CONSTRAINT "event_hosts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_organizers" ADD CONSTRAINT "event_organizers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_organizers" ADD CONSTRAINT "event_organizers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_schedule_items" ADD CONSTRAINT "event_schedule_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judging_criteria" ADD CONSTRAINT "judging_criteria_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_judge_id_fkey" FOREIGN KEY ("judge_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_judge_id_fkey" FOREIGN KEY ("judge_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "judging_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "org_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "org_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_member_contributions" ADD CONSTRAINT "org_member_contributions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "org_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_member_contributions" ADD CONSTRAINT "org_member_contributions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
