-- Web Push subscriptions are accepted only from a logged-in Beta Access administrator.
-- Endpoints and subscription keys are delivery capabilities: never expose them via the admin API.
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
 endpoint_hash TEXT PRIMARY KEY,
 endpoint TEXT NOT NULL,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_notification_outbox (
 id TEXT PRIMARY KEY,
 installation_id TEXT NOT NULL REFERENCES installations(id),
 app_id TEXT NOT NULL CHECK(app_id='wemuldroid'),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_notification_pending ON admin_notification_outbox(sent_at,next_attempt_at,created_at);
