-- Additive, private passkey storage; old ADMIN_TOKEN remains active as recovery.
CREATE TABLE IF NOT EXISTS admin_passkeys (
 id TEXT PRIMARY KEY,
 public_key TEXT NOT NULL,
 counter INTEGER NOT NULL DEFAULT 0,
 transports_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
 claim_code TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL,
 approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_passkeys_state ON admin_passkeys(status,created_at);

CREATE TABLE IF NOT EXISTS admin_passkey_challenges (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('register','authenticate')),
 challenge TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_passkey_challenges_expiry ON admin_passkey_challenges(expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY,
 passkey_id TEXT NOT NULL REFERENCES admin_passkeys(id),
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
