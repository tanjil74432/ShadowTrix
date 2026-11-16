-- Synthetic data for performance checks ONLY. Run against a scratch database (never the development or a real database).
-- 50,000 users, 2,000 events, ~300,000 registrations, 5,000 teams, 5,000 submissions, 30,000 scores, 500,000 audit rows.
\set ON_ERROR_STOP on
INSERT INTO users (id, email, password_hash, full_name, email_verified_at, status, created_at, updated_at)
SELECT gen_random_uuid(), 'perf-' || g || '@example.test', '$argon2id$perf-not-a-real-hash', 'Perf User ' || g, now(), 'ACTIVE', now() - (g % 365) * interval '1 day', now()
FROM generate_series(1, 50000) g;
INSERT INTO user_roles (id, user_id, role, created_at) SELECT gen_random_uuid(), id, 'PARTICIPANT', now() FROM users WHERE email LIKE 'perf-%';

CREATE TEMP TABLE pu AS SELECT id, row_number() OVER (ORDER BY email) AS n FROM users WHERE email LIKE 'perf-%';
CREATE INDEX ON pu (n);

INSERT INTO events (id, slug, title, category, summary, description, status, starts_at, ends_at, registration_opens_at, registration_closes_at, registration_mode, min_team_size, max_team_size, location_type, timezone, created_at, updated_at, created_by_id)
SELECT gen_random_uuid(), 'perf-event-' || g, 'Perf Event ' || g || CASE WHEN g % 7 = 0 THEN ' datathon' ELSE ' hackathon' END,
  (ARRAY['HACKATHON','DATATHON','AI_ML','PROGRAMMING_CONTEST','WORKSHOP','SUMMIT','INNOVATION_CHALLENGE','OTHER'])[1 + g % 8]::"EventCategory",
  'Summary ' || g, 'Description ' || g,
  (ARRAY['PUBLISHED','PUBLISHED','PUBLISHED','DRAFT','CANCELLED','ARCHIVED'])[1 + g % 6]::"EventStatus",
  now() + (g % 400 - 200) * interval '1 day', now() + (g % 400 - 199) * interval '1 day',
  now() + (g % 400 - 230) * interval '1 day', now() + (g % 400 - 205) * interval '1 day',
  CASE WHEN g % 5 = 0 THEN 'TEAM' ELSE 'INDIVIDUAL' END::"RegistrationMode", CASE WHEN g % 5 = 0 THEN 2 END, CASE WHEN g % 5 = 0 THEN 4 END, 'ONLINE', 'UTC', now() - (g % 365) * interval '1 day', now(),
  (SELECT id FROM pu WHERE n = 1)
FROM generate_series(1, 2000) g;

CREATE TEMP TABLE pe AS SELECT id, row_number() OVER (ORDER BY slug) AS n FROM events WHERE slug LIKE 'perf-event-%';
INSERT INTO event_organizers (event_id, user_id, is_lead) SELECT e.id, (SELECT id FROM pu WHERE n = 1 + (e.n % 50)), true FROM pe e;

INSERT INTO registrations (id, event_id, user_id, status, registered_at)
SELECT gen_random_uuid(), e.id, u.id, (ARRAY['CONFIRMED','CONFIRMED','CONFIRMED','WAITLISTED'])[1 + (k % 4)]::"RegistrationStatus", now() - ((e.n * 7 + k) % 365) * interval '1 day' - (k % 86400) * interval '1 second'
FROM pe e CROSS JOIN LATERAL generate_series(1, 150) k JOIN pu u ON u.n = 1 + ((e.n * 37 + k * 101) % 50000);

-- teams for the team events
INSERT INTO teams (id, event_id, name, leader_id, status, created_at, updated_at)
SELECT gen_random_uuid(), e.id, 'Perf Team ' || e.n || '-' || t, (SELECT id FROM pu WHERE n = 1 + ((e.n * 13 + t) % 50000)), 'ACTIVE', now(), now()
FROM pe e JOIN events ev ON ev.id = e.id AND ev.registration_mode = 'TEAM' CROSS JOIN generate_series(1, 12) t;
INSERT INTO team_members (team_id, event_id, user_id, role, joined_at)
SELECT t.id, t.event_id, t.leader_id, 'LEADER', now() FROM teams t WHERE t.name LIKE 'Perf Team %';

-- submissions, criteria, judges, scores
INSERT INTO submissions (id, event_id, owner_id, title, description, status, submitted_at, created_at, updated_at, extra_links, current_version)
SELECT gen_random_uuid(), r.event_id, r.user_id, 'Perf Project', 'd', 'SUBMITTED', now(), now(), now(), ARRAY[]::text[], 1
FROM (SELECT DISTINCT ON (event_id) event_id, user_id FROM registrations WHERE status = 'CONFIRMED' ORDER BY event_id, registered_at) r
JOIN events e ON e.id = r.event_id AND e.registration_mode = 'INDIVIDUAL' LIMIT 1600;
INSERT INTO judging_criteria (id, event_id, name, max_score, weight, sort_order) SELECT gen_random_uuid(), s.event_id, 'Quality', 10, 1, 0 FROM submissions s;
INSERT INTO judge_assignments (event_id, judge_id, created_at) SELECT s.event_id, (SELECT id FROM pu WHERE n = 2), now() FROM submissions s ON CONFLICT DO NOTHING;
INSERT INTO scores (id, submission_id, judge_id, criterion_id, score, finalized_at, created_at, updated_at)
SELECT gen_random_uuid(), s.id, (SELECT id FROM pu WHERE n = 2), c.id, 7, now(), now(), now() FROM submissions s JOIN judging_criteria c ON c.event_id = s.event_id;

-- audit trail
INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, created_at)
SELECT gen_random_uuid(), (SELECT id FROM pu WHERE n = 1 + (g % 50000)),
  (ARRAY['auth.login','auth.login','auth.logout','registration.create','event.update','score.saved','auth.password_changed','admin.role_granted','mfa.enabled','team.invite'])[1 + g % 10],
  'user', 'x' || g, now() - (g % 365) * interval '1 day' - (g % 86400) * interval '1 second'
FROM generate_series(1, 500000) g;

-- an administrator with a known session token (for HTTP timing): token = perf-admin-session-token
INSERT INTO users (id, email, password_hash, full_name, email_verified_at, status, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000000aa', 'perf-admin@example.test', '$argon2id$perf-not-a-real-hash', 'Perf Admin', now(), 'ACTIVE', now(), now());
INSERT INTO user_roles (id, user_id, role, created_at) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000aa', 'ADMIN', now());
INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000aa', encode(sha256('perf-admin-session-token'::bytea), 'hex'), now(), now(), now() + interval '1 day');
ANALYZE;
SELECT 'users' t, count(*) FROM users UNION ALL SELECT 'events', count(*) FROM events UNION ALL SELECT 'registrations', count(*) FROM registrations UNION ALL SELECT 'teams', count(*) FROM teams UNION ALL SELECT 'submissions', count(*) FROM submissions UNION ALL SELECT 'scores', count(*) FROM scores UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
