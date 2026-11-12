-- Secure, short-lived pairing codes for replacing/adding a Beta Access admin phone.
-- Only hashes are stored. Each 128-bit code may be consumed once.
CREATE TABLE IF NOT EXISTS admin_phone_pairings (
 code_hash TEXT PRIMARY KEY,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_phone_pairings_expiry ON admin_phone_pairings(expires_at,used_at);

-- Bind the WebAuthn registration challenge to the specific pairing code.
ALTER TABLE admin_passkey_challenges ADD COLUMN pairing_hash TEXT;
