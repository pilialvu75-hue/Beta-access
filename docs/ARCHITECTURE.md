# AIVEXUS Beta Access — separation of responsibilities

## Central service (this repository)

Cloudflare Worker, D1, official installer catalog, stable QR/download page, administrator Android PWA, approve/deny/revoke operations, and filtered telemetry relay.

**No application-specific launcher/SDK/AVD is packaged here.** No API tokens or passwords are committed. The service is intended to support multiple apps; the first implementation currently handles only the `wemuldroid` app ID.

## Per-application adapter (WEmulDroid repository)

The Windows launcher may include `BETA_ACCESS_URL.txt` **only in an explicitly gated pilot build**. On first start it asks to enroll and blocks use until approval. The device secret is bound to the current Windows user through DPAPI; the server stores a SHA-256 hash, not a plaintext device secret. Test credentials are never embedded in installer binaries.

The installer and platform-specific metrics remain under WEmulDroid's codebase, not under Beta Access. Existing installers stay ungated.

## Diagnostics repository

Each application publishes only redacted, consented events under its own release/asset namespace. The central Worker forwards events to the dedicated Diagnostics repository using a secret stored exclusively on the Cloudflare side.

## Unfinished integrations

- Cloudflare Worker deployment, D1 migration, admin secret, diagnostics GitHub token and HTTPS URL.
- Approved beta installer published with the gate turned on, real Android and Windows test.
- Native Android app and push notifications; the PWA supports polling while opened.
- All-app extension beyond WEmulDroid.
- Edge rate limits / Cloudflare Access before public invitations.
