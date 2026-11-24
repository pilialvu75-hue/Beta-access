-- Isolated VoiceBridge beta OTA: does not relax WEmulDroid-only CHECK
-- constraints on existing installations and tester_invites tables.
-- One-time invitations, per-device credentials, admin approval/revocation.
CREATE TABLE IF NOT EXISTS voicebridge_ota_invites (
  token_sha256 TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_installation_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS voicebridge_ota_devices (
  installation_id TEXT PRIMARY KEY,
  secret_sha256 TEXT NOT NULL,
  label TEXT NOT NULL,
  current_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','approved','revoked')),
  registered_at TEXT NOT NULL,
  approved_until TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_voicebridge_devices_state
  ON voicebridge_ota_devices(state, registered_at DESC);
