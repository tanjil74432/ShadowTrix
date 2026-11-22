-- Board members can have a university (e.g. "Eastern University"). Additive and nullable: existing members keep working with no value.
ALTER TABLE "org_members" ADD COLUMN "university" TEXT;
