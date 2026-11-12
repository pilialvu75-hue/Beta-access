-- Only an existing authenticated administrator can create a new-device pairing code.
-- The raw one-time 96-bit code is never stored in the database.
CREATE TABLE IF NOT EXISTS admin_device_pairings (
 code_hash TEXT PRIMARY KEY,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_device_pairings_created ON admin_device_pairings(created_at);
ALTER TABLE admin_passkey_challenges ADD COLUMN pairing_hash TEXT;
