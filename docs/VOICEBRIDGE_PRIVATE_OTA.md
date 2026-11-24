# VoiceBridge private HTTP OTA — owner pilot

**State:** source-only, tested in PR #23. The route defaults to **disabled**
and is not a deployed or physically verified update mechanism yet.

## Purpose and origin

The VoiceBridge client reuses the behavior of AI Orchestrator's original
`UpdateChecker` and `WindowsUpdateInstaller`: an HTTPS version manifest,
streamed/restartable Windows installer download, expected size and SHA-256,
explicit user consent and installation handoff. No GitHub account or CLI
is needed on the **customer's PC**. GitHub Actions continues to build releases;
Beta Access acts only as a private authorization/metadata redirector.

The GitHub repository `pilialvu75-hue/AIVEXUS-VoiceBridge` remains PRIVATE.
The Worker itself never streams the ~958 MB binary. Instead GitHub's
authenticated release-asset API can return an HTTPS 302 to a short-lived,
pre-signed `release-assets.githubusercontent.com` URL. See
https://docs.github.com/en/rest/releases/assets. A 200 from GitHub on this
API is **rejected**, rather than being proxied through a free Worker.

## Endpoints (feature-gated)

- `POST /api/admin/voicebridge/invite`: administrator passkey or admin
  credentials; accepts `{"expires_days":7}`, returns a **one-time** invitation.
- `POST /api/voicebridge/v1/enroll`: Windows app submits this invitation,
  newly generated UUID and random device secret; response: `pending`.
- `GET /api/admin/voicebridge/devices`: admin sees requests without secrets.
- `POST /api/admin/voicebridge/devices/{uuid}/decision`: approve for a
  specified number of days or revoke. PWA controls are implemented.
- `GET /api/voicebridge/v1/status`: device-key authorization status.
- `GET /api/voicebridge/v1/update`: only approved, unexpired device; returns
  `app_id=voicebridge`, version/channel, manifest URL, size, SHA-256.
- `GET /api/voicebridge/v1/asset/{id}/{filename}.exe`: only approved device;
  response 302 to verified private GitHub CDN asset; no binary proxy.

Device authentication: `x-device-id` (UUID v4), `x-device-key` (64 lowercase
hex characters). Treat both as private. They are created per installation
after explicit owner invitation, **not embedded in distributed executables**.
The client must remove these headers when following a redirect to GitHub CDN;
VoiceBridge's HTTP transport has tests for this.

## Server-only setup needed before owner test

1. In **Beta-access** GitHub Actions secrets, provision
   `VOICEBRIDGE_RELEASES_TOKEN`, with read-only access to the VoiceBridge
   repository's release assets. Never paste it into chat, app, logs or files.
2. Confirm the Beta Access `VOICEBRIDGE_OTA_ENABLED` gate is OFF by default.
   This PR keeps it OFF in `wrangler.toml`.
3. A manual deployment of Beta Access can be triggered via
   `.github/workflows/deploy.yml` only after code review. The owner opts in to
   `enable_voicebridge_ota=true` and `voicebridge_gate_confirmed=true`.
   The workflow requires that read-only token and sets it as a Cloudflare
   **Worker secret**, never a public variable.
4. Using the existing administrator PWA
   `https://aivexus-beta-access.aivexus-lab.workers.dev/admin/`, create
   one single-use VoiceBridge invite, enter it in VoiceBridge Windows,
   then approve that device on the PWA. Enrollment is disabled until step 3.
5. Verify update discovery, download and size/hash on an approved Windows PC,
   unapproved devices receiving 403, expiring/revoked device denial, wrong
   version and error recovery. Two consecutive owner-only upgrades:
   N→N+1→N+2, preserving app data and audio models.
6. Rollback at any time: rerun deployment with
   `enable_voicebridge_ota=false`; no private files are made public.

No additional paid services have been enabled. The server receives only small
metadata and authorization requests, not full binary downloads. GitHub's
short-lived CDN link remains usable by a holder until its expiry; revocation
cannot invalidate an already-issued signed URL instantly. This is acceptable
only for a limited owner beta, not a complete commercial license system.

## Unresolved requirements

- **Real GitHub 302 behavior** for this account and exact private asset: mock
  tests pass, but a live authorized request is required. If GitHub returns 200,
  the Worker refuses to proxy 958 MB. Alternate storage would need evaluation.
- Secure Windows credential storage: the owner-only prototype uses
  per-device random credentials persisted locally via Flutter preferences.
  Before commercial deployment, switch to Windows DPAPI/Credential Manager.
- Windows Smart App Control may block unsigned installers. Signing is postponed
  at the owner's request; do not disable or bypass Windows security.
- API test success does not prove in-app installation on the ASUS.
- Investigate the historic **private-repository AI Orchestrator updater** path
  rather than assume it was identical to today's GitHub release URLs.
