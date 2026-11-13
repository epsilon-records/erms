-- Test data for the Schemathesis job (.github/workflows/api-fuzz.yml), run as the database owner
-- on the throwaway CI database only. It does what an owner creating a key in the app does
-- (app.create_api_key: an agent membership plus the key row, which stores only the key's hash),
-- then adds a small catalogue so list and detail reads return real rows.
--
--   psql -v key_hash=<sha256 of the key> -f seed.sql
--
-- The ids are fixed so schemathesis.detail.toml can name them.

\set ON_ERROR_STOP on

INSERT INTO orgs (id, name, slug)
VALUES ('01900000-0000-7000-8000-000000000001', 'API fuzz label', 'api-fuzz');

INSERT INTO labels (id, org_id, name)
VALUES ('01900000-0000-7000-8000-000000000002', '01900000-0000-7000-8000-000000000001', 'API fuzz imprint');

-- The key's agent: a member of the label with the `agent` role, as app.create_api_key adds it.
INSERT INTO memberships (org_id, user_id, role, onboarded_at)
VALUES ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000003', 'agent', now());

INSERT INTO api_keys (id, org_id, actor_id, name, prefix, key_sha256, scopes, created_by)
VALUES (
  '01900000-0000-7000-8000-000000000004', '01900000-0000-7000-8000-000000000001',
  '01900000-0000-7000-8000-000000000003', 'Schemathesis', 'fuzzci00', :'key_hash',
  ARRAY['catalog:read'], '01900000-0000-7000-8000-000000000003'
);

INSERT INTO parties (id, org_id, kind, display_name, match_key) VALUES
  ('01900000-0000-7000-8000-000000000010', '01900000-0000-7000-8000-000000000001', 'person', 'Test Artist', 'test artist'),
  ('01900000-0000-7000-8000-000000000011', '01900000-0000-7000-8000-000000000001', 'group', 'Test Group', 'test group');

INSERT INTO recordings (id, org_id, isrc, title, version_title, duration_ms, genre) VALUES
  ('01900000-0000-7000-8000-000000000020', '01900000-0000-7000-8000-000000000001', 'QZFZZ2600001', 'First Track', NULL, 215000, 'Techno'),
  ('01900000-0000-7000-8000-000000000021', '01900000-0000-7000-8000-000000000001', 'QZFZZ2600002', 'Second Track', 'Extended Mix', 402000, 'Techno'),
  ('01900000-0000-7000-8000-000000000022', '01900000-0000-7000-8000-000000000001', 'QZFZZ2600003', 'Third Track', NULL, NULL, NULL);

INSERT INTO releases (id, org_id, label_id, upc, catalog_number, title, type, release_date, genre) VALUES
  ('01900000-0000-7000-8000-000000000030', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002', '000000000001', 'FUZ001', 'First Release', 'ep', '2026-01-09', 'Techno'),
  ('01900000-0000-7000-8000-000000000031', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002', '000000000002', NULL, 'Second Release', 'single', NULL, NULL);

INSERT INTO release_tracks (org_id, release_id, recording_id, disc, position) VALUES
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000030', '01900000-0000-7000-8000-000000000020', 1, 1),
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000030', '01900000-0000-7000-8000-000000000021', 1, 2),
  ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000031', '01900000-0000-7000-8000-000000000022', 1, 1);

INSERT INTO credits (id, org_id, recording_id, release_id, party_id, role, position, source, approved_at) VALUES
  ('01900000-0000-7000-8000-000000000040', '01900000-0000-7000-8000-000000000001', NULL, '01900000-0000-7000-8000-000000000030', '01900000-0000-7000-8000-000000000010', 'main', 0, 'seed', now()),
  ('01900000-0000-7000-8000-000000000041', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000020', NULL, '01900000-0000-7000-8000-000000000010', 'main', 0, 'seed', now()),
  ('01900000-0000-7000-8000-000000000042', '01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000021', NULL, '01900000-0000-7000-8000-000000000011', 'remixer', 0, 'seed', NULL);

-- A second label with rows of its own: a key must never see these.
INSERT INTO orgs (id, name, slug)
VALUES ('01900000-0000-7000-8000-000000000101', 'Other fuzz label', 'api-fuzz-other');
INSERT INTO recordings (id, org_id, isrc, title)
VALUES ('01900000-0000-7000-8000-000000000120', '01900000-0000-7000-8000-000000000101', 'QZFZZ2600099', 'Not yours');
