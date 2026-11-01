-- Local-only demo data. This script inserts or reuses one named home and does not delete data.
INSERT INTO homes (name)
SELECT 'Local Demo Home - Shared Bill Splitter'
WHERE NOT EXISTS (
  SELECT 1 FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter'
);

INSERT INTO members (home_id, name)
SELECT (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1), 'Asha'
WHERE NOT EXISTS (
  SELECT 1 FROM members
  WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
    AND name = 'Asha'
);
INSERT INTO members (home_id, name)
SELECT (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1), 'Ben'
WHERE NOT EXISTS (
  SELECT 1 FROM members
  WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
    AND name = 'Ben'
);
INSERT INTO members (home_id, name)
SELECT (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1), 'Chitra'
WHERE NOT EXISTS (
  SELECT 1 FROM members
  WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
    AND name = 'Chitra'
);

INSERT OR IGNORE INTO bills (id, home_id, title, total_cents)
SELECT
  '00000000-0000-4000-8000-000000000001',
  id,
  'Electricity - unpaid',
  1000
FROM homes
WHERE id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents)
SELECT '00000000-0000-4000-8000-000000000001', id, 334 FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Asha';
INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents)
SELECT '00000000-0000-4000-8000-000000000001', id, 333 FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Ben';
INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents)
SELECT '00000000-0000-4000-8000-000000000001', id, 333 FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Chitra';

INSERT OR IGNORE INTO bills (id, home_id, title, total_cents)
SELECT
  '00000000-0000-4000-8000-000000000002',
  id,
  'Internet - partly paid',
  1200
FROM homes
WHERE id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents, paid_at, idempotency_key)
SELECT
  '00000000-0000-4000-8000-000000000002',
  id,
  400,
  '2026-11-01T12:00:00.000Z',
  'local-seed-already-paid'
FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Asha';
INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents)
SELECT '00000000-0000-4000-8000-000000000002', id, 400 FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Ben';
INSERT OR IGNORE INTO shares (bill_id, member_id, amount_cents)
SELECT '00000000-0000-4000-8000-000000000002', id, 400 FROM members
WHERE home_id = (SELECT id FROM homes WHERE name = 'Local Demo Home - Shared Bill Splitter' ORDER BY id LIMIT 1)
  AND name = 'Chitra';

SELECT id AS home_id, name FROM homes
WHERE name = 'Local Demo Home - Shared Bill Splitter'
ORDER BY id
LIMIT 1;
