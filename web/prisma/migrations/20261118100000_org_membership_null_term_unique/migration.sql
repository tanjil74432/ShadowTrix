-- The existing unique (member, unit, designation, term) cannot stop duplicates when the term is NULL (NULLs are distinct).
-- Found by the administration tests. A person holds a given designation in a given unit at most once without a term.
CREATE UNIQUE INDEX "org_memberships_no_term_unique_idx" ON "org_memberships" ("member_id", "unit_id", "designation_id") WHERE "term_id" IS NULL;
