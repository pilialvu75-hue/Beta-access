CREATE TABLE IF NOT EXISTS installations (
 id TEXT PRIMARY KEY,
 app_id TEXT NOT NULL CHECK(app_id IN ('wemuldroid')),
 secret_sha256 TEXT NOT NULL,
 label TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('windows')),
 version TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','revoked')),
 requested_at TEXT NOT NULL,
 decided_at TEXT,
 approved_until TEXT,
 telemetry_consent INTEGER NOT NULL DEFAULT 0 CHECK(telemetry_consent IN (0,1)),
 last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_installations_state_requested ON installations(state, requested_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_outbox (
 event_id TEXT PRIMARY KEY,
 installation_id TEXT NOT NULL REFERENCES installations(id),
 payload_json TEXT NOT NULL,
 received_at TEXT NOT NULL,
 shipped_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_telemetry_unshipped ON telemetry_outbox(shipped_at,received_at);
