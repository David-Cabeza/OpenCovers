import type { Migration } from "./migrations";

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL,
  zone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  start_epoch INTEGER NOT NULL,
  end_epoch INTEGER NOT NULL,
  party_size INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  booked_via TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '',
  owner_principal TEXT NOT NULL DEFAULT '',
  guest_name TEXT NOT NULL DEFAULT '',
  guest_contact TEXT NOT NULL DEFAULT '',
  erased INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS table_allocations (
  reservation_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  start_epoch INTEGER NOT NULL,
  end_epoch INTEGER NOT NULL,
  PRIMARY KEY (reservation_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_allocations_table ON table_allocations(table_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  tombstone_hash TEXT,
  occurred_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS allocation_no_overlap_insert
BEFORE INSERT ON table_allocations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM table_allocations a
    JOIN reservations r ON r.id = a.reservation_id
    WHERE a.table_id = NEW.table_id
      AND r.status IN ('booked', 'seated')
      AND a.start_epoch < NEW.end_epoch
      AND NEW.start_epoch < a.end_epoch
  ) THEN RAISE(ABORT, 'slot_taken') END;
END;

CREATE TRIGGER IF NOT EXISTS allocation_no_overlap_update
BEFORE UPDATE ON table_allocations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM table_allocations a
    JOIN reservations r ON r.id = a.reservation_id
    WHERE a.table_id = NEW.table_id
      AND a.reservation_id != NEW.reservation_id
      AND r.status IN ('booked', 'seated')
      AND a.start_epoch < NEW.end_epoch
      AND NEW.start_epoch < a.end_epoch
  ) THEN RAISE(ABORT, 'slot_taken') END;
END;

CREATE TABLE IF NOT EXISTS tombstones (
  reservation_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  notice_address TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 15,
  open_start TEXT NOT NULL DEFAULT '12:00',
  open_end TEXT NOT NULL DEFAULT '23:00'
);

INSERT INTO config (id, enabled, notice_address, timezone, slot_interval_minutes, open_start, open_end)
VALUES (1, 0, '', 'UTC', 15, '12:00', '23:00')
ON CONFLICT(id) DO NOTHING;

INSERT INTO tables (id, name, seats, zone) VALUES
  ('1', 'T1', 2, ''),
  ('2', 'T2', 2, ''),
  ('3', 'T3', 4, ''),
  ('4', 'T4', 4, ''),
  ('5', 'T5', 6, '')
ON CONFLICT(id) DO NOTHING;
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: SCHEMA_V1 },
  {
    version: 2,
    sql: "ALTER TABLE config ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 400",
  },
  {
    version: 3,
    sql: "CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at)",
  },
  {
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS services (
  name TEXT PRIMARY KEY,
  open_start TEXT NOT NULL,
  open_end TEXT NOT NULL
);

INSERT INTO services (name, open_start, open_end) VALUES
  ('lunch', '12:00', '16:00'),
  ('dinner', '19:00', '23:00')
ON CONFLICT(name) DO NOTHING;

ALTER TABLE reservations ADD COLUMN service TEXT NOT NULL DEFAULT '';
`,
  },
];
