-- Measures the queries behind the busiest pages and the analytics, with EXPLAIN (ANALYZE). Run after seed-large.sql on the same scratch database.
\set QUIET on
SELECT id AS ev FROM events WHERE slug = 'perf-event-10' \gset
SELECT user_id AS uid FROM registrations WHERE event_id = :'ev' LIMIT 1 \gset
\echo '== 1 public event list: published, category filter + keyword, page 1 (+ count)'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM events WHERE status = 'PUBLISHED' AND category = 'HACKATHON' AND (title ILIKE '%hackathon%' OR summary ILIKE '%hackathon%') ORDER BY starts_at, id LIMIT 12;
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM events WHERE status = 'PUBLISHED' AND category = 'HACKATHON' AND (title ILIKE '%hackathon%' OR summary ILIKE '%hackathon%');
\echo '== 2 organizer participant list: one event, page 1 of 25 (+ count and status groups)'
EXPLAIN (ANALYZE, SUMMARY) SELECT r.id, u.full_name, u.email FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.event_id = :'ev' ORDER BY r.registered_at, r.id LIMIT 25;
EXPLAIN (ANALYZE, SUMMARY) SELECT status, count(*) FROM registrations WHERE event_id = :'ev' GROUP BY status;
\echo '== 3 participant dashboard: my registrations'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM registrations WHERE user_id = :'uid' ORDER BY registered_at DESC, id LIMIT 100;
\echo '== 4 admin users: newest page, and a search'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM users ORDER BY created_at DESC LIMIT 25;
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM users WHERE email LIKE '%perf-4999%' OR full_name ILIKE '%perf-4999%' ORDER BY created_at DESC LIMIT 25;
\echo '== 5 audit viewer: newest page; security view with a date range; count'
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 50;
EXPLAIN (ANALYZE, SUMMARY) SELECT id FROM audit_logs WHERE (action LIKE 'auth.%' OR action LIKE 'mfa.%') AND created_at >= now() - interval '30 days' ORDER BY created_at DESC, id DESC LIMIT 50;
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM audit_logs WHERE (action LIKE 'auth.%' OR action LIKE 'mfa.%') AND created_at >= now() - interval '30 days';
\echo '== 6 analytics, 30-day range: registrations per day, status groups, distinct participants, new users'
EXPLAIN (ANALYZE, SUMMARY) SELECT date_trunc('day', registered_at AT TIME ZONE 'UTC') AS day, count(*) FROM registrations WHERE registered_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1;
EXPLAIN (ANALYZE, SUMMARY) SELECT count(DISTINCT user_id) FROM registrations WHERE status <> 'CANCELLED' AND registered_at >= now() - interval '30 days';
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days';
\echo '== 7 analytics, 366-day range'
EXPLAIN (ANALYZE, SUMMARY) SELECT date_trunc('day', registered_at AT TIME ZONE 'UTC') AS day, count(*) FROM registrations WHERE registered_at >= now() - interval '366 days' GROUP BY 1 ORDER BY 1;
\echo '== 8 analytics: judging completion (whole platform)'
EXPLAIN (ANALYZE, SUMMARY)
WITH crit AS (SELECT event_id, count(*) AS n FROM judging_criteria GROUP BY event_id),
subs AS (SELECT event_id, count(*) AS n FROM submissions WHERE status IN ('SUBMITTED','UNDER_REVIEW','SCORED') GROUP BY event_id),
judges AS (SELECT event_id, count(*) AS n FROM judge_assignments GROUP BY event_id),
done AS (SELECT s.event_id, count(*) AS n FROM (SELECT sc.submission_id, sc.judge_id FROM scores sc GROUP BY sc.submission_id, sc.judge_id HAVING count(*) FILTER (WHERE sc.finalized_at IS NOT NULL) = count(*)) f JOIN submissions s ON s.id = f.submission_id JOIN crit c ON c.event_id = s.event_id WHERE (SELECT count(*) FROM scores x WHERE x.submission_id = f.submission_id AND x.judge_id = f.judge_id) = c.n GROUP BY s.event_id)
SELECT coalesce(sum(j.n), 0), coalesce(sum(j.n * coalesce(s.n, 0)), 0), coalesce(sum(d.n), 0) FROM judges j LEFT JOIN subs s ON s.event_id = j.event_id LEFT JOIN done d ON d.event_id = j.event_id;
\echo '== 9 analytics: groupings over events, teams, roles'
EXPLAIN (ANALYZE, SUMMARY) SELECT status, count(*) FROM events GROUP BY status;
EXPLAIN (ANALYZE, SUMMARY) SELECT role::text, count(DISTINCT user_id) FROM user_roles GROUP BY role;
EXPLAIN (ANALYZE, SUMMARY) SELECT count(DISTINCT team_id) FROM registrations WHERE team_id IS NOT NULL AND status <> 'CANCELLED';
