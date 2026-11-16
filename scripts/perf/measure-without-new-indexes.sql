-- The same queries without the four indexes added in migration 20261118090000, to show what each index buys. Changes are rolled back.
\set QUIET on
BEGIN;
DROP INDEX audit_logs_created_at_idx; DROP INDEX audit_logs_action_created_at_idx; DROP INDEX users_created_at_idx; DROP INDEX registrations_registered_at_idx;
\echo '== users newest page'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM users ORDER BY created_at DESC LIMIT 25;
\echo '== audit newest page'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 50;
\echo '== audit security view, 30 days (page)'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM audit_logs WHERE (action LIKE 'auth.%' OR action LIKE 'mfa.%') AND created_at >= now() - interval '30 days' ORDER BY created_at DESC, id DESC LIMIT 50;
\echo '== audit count, 30 days'
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM audit_logs WHERE (action LIKE 'auth.%' OR action LIKE 'mfa.%') AND created_at >= now() - interval '30 days';
\echo '== registrations per day, 30 days'
EXPLAIN (ANALYZE, SUMMARY) SELECT date_trunc('day', registered_at AT TIME ZONE 'UTC') AS day, count(*) FROM registrations WHERE registered_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1;
\echo '== new users, 30 days'
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days';
ROLLBACK;
