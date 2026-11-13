-- Private app-scoped invitations. The token is NEVER stored; only SHA-256.
-- The tester email is an intended recipient label, NOT a verified email identity.
-- Pilot app remains WEmulDroid until other application runtimes are integrated.
CREATE TABLE IF NOT EXISTS tester_invites (
 id TEXT PRIMARY KEY,
 app_id TEXT NOT NULL CHECK(app_id IN ('wemuldroid')),
 token_sha256 TEXT NOT NULL UNIQUE,
 tester_name TEXT NOT NULL,
 tester_email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 claimed_at TEXT,
 claimed_installation_id TEXT UNIQUE REFERENCES installations(id)
);
CREATE INDEX IF NOT EXISTS idx_invites_created ON tester_invites(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_email ON tester_invites(app_id,tester_email);

ALTER TABLE installations ADD COLUMN invite_id TEXT REFERENCES tester_invites(id);
CREATE INDEX IF NOT EXISTS idx_installations_invite_id ON installations(invite_id);
