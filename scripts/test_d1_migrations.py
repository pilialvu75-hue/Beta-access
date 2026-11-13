"""Dry-run all D1 SQL migrations on SQLite; no Cloudflare account or secrets used."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
migrations = sorted((root / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
assert len(migrations) >= 5, f"Unexpected migration count: {len(migrations)}"
conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")
seed_install_id = "e12d4a17-5e3f-44f1-8f23-f3cb7596bd51"
seed_passkey = "test-approved-passkey"
seed_endpoint = "test-push-endpoint-hash"

for path in migrations:
    conn.executescript(path.read_text("utf-8"))
    if path.name.startswith("0003_"):
        # Existing owner data must survive subsequent migrations 0004 and 0005.
        conn.execute(
            "INSERT INTO installations("
            "id,app_id,secret_sha256,label,platform,version,state,requested_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (
                seed_install_id, "wemuldroid", "a" * 64, "Existing pilot",
                "windows", "0.9.0-beta.10", "revoked", "2026-11-12T00:00:00Z"
            ),
        )
        conn.execute(
            "INSERT INTO admin_passkeys(id,public_key,status,claim_code,created_at)"
            " VALUES(?,?,?,?,?)",
            (seed_passkey, "mock-public-key", "approved", "ABCDEF012345", "2026-11-12T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO admin_push_subscriptions("
            "endpoint_hash,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)",
            (seed_endpoint, "https://example.invalid/push", "testp256", "testauth", "2026-11-12T00:00:00Z"),
        )
        conn.commit()

names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
expected = {
    "installations", "telemetry_outbox", "admin_passkeys",
    "admin_passkey_challenges", "admin_sessions",
    "admin_push_subscriptions", "admin_notification_outbox",
    "admin_device_pairings", "tester_invites",
}
assert expected <= names, f"Missing D1 tables: {expected - names}"
columns = lambda table: {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
assert "pairing_hash" in columns("admin_passkey_challenges")
assert "invite_id" in columns("installations")
assert {"token_sha256","claimed_installation_id","expires_at"} <= columns("tester_invites")
assert conn.execute("SELECT COUNT(*) FROM admin_passkeys WHERE id=? AND status='approved'", (seed_passkey,)).fetchone()[0] == 1
assert conn.execute("SELECT COUNT(*) FROM admin_push_subscriptions WHERE endpoint_hash=?", (seed_endpoint,)).fetchone()[0] == 1
assert conn.execute("SELECT COUNT(*) FROM installations WHERE id=? AND state='revoked'", (seed_install_id,)).fetchone()[0] == 1
conn.execute(
    "INSERT INTO tester_invites(id,app_id,token_sha256,tester_name,tester_email,status,created_at,expires_at)"
    " VALUES(?,?,?,?,?,?,?,?)",
    (
        "0d2abce0-d305-4dd1-96c4-8f1622e5d6c7",
        "wemuldroid", "b" * 64, "Tester previsto", "tester@example.org",
        "active", "2026-11-13T00:00:00Z", "2026-11-16T00:00:00Z"
    ),
)
conn.execute(
    "UPDATE installations SET invite_id=? WHERE id=?",
    ("0d2abce0-d305-4dd1-96c4-8f1622e5d6c7", seed_install_id),
)
assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
print(f"PASS: {len(migrations)} incremental SQL migrations, existing passkey/push preserved, invite FK valid.")
conn.close()
