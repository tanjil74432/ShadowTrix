-- Signup redesign (account-takeover fix): registration now collects only an email address. The account exists in a
-- "pending" state without a password until the owner of the mailbox proves control by using the emailed link and
-- chooses the password themselves. A pending account therefore has no credentials an attacker could have chosen.

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Database-level guarantee: an account can only be email-verified if it has a password. A verified account without
-- credentials, or a way to verify without choosing one, is impossible even if application code has a bug.
ALTER TABLE "users"
  ADD CONSTRAINT "users_verified_requires_password_chk"
  CHECK ("email_verified_at" IS NULL OR "password_hash" IS NOT NULL);
