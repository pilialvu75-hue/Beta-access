# WEmulDroid pilot — AIVEXUS Beta Access

**Status: source prototype; independent backend awaiting deployment, installer integration and on-device tests. NOT DEPLOYED. No live QR, authorization server, push notification or gated WEmulDroid installer has been verified yet.**

This is independent of Ai-orchestrator-riserva. The **administrator uses an installable Android PWA**; the tested WEmulDroid application runs on **Windows**. The pilot deliberately preserves existing stable/beta installations, Android SDKs, AVDs and reports.

## End-to-end flow

1. Administrator opens the Android PWA at the eventual `https://<your-Cloudflare-Worker>/admin/`, enters a private admin secret (memory-only session).
2. App fetches latest verified *official* WEmulDroid GitHub beta installer; permanent URL `/d/wemuldroid` shows actual version, Windows warning and a button redirecting to the official EXE. QR SVG is `/qr/wemuldroid.svg`; both have a stable URL.
3. Administrator taps Copy, Share, or Prepare email (opens the phone email composer; **does not send mail silently**).
4. On a **specifically built gated beta installer**, the tester sees the "Richiedi autorizzazione" gate on first launch. Enrolling requires a pseudonymous label and offers explicit consent for telemetry.
5. A random installation UUID and 256-bit device secret are generated; the secret is stored locally using **Windows DPAPI CurrentUser**. Only its SHA-256 is stored in Cloudflare D1. No GitHub token is bundled with Windows.
6. Administrator sees pending requests on the Android PWA (when opened; polling while visible), authorizes for **1, 7, 30, 90 or 365 days**, denies, or revokes. The tester presses "Controlla stato", and the app unlocks only after the server reports an unexpired approval.
7. Every subsequent launch of a gated installer needs an online status check; if the service is unavailable, gated beta access **fails closed**. Offline signed leases and immediate revocation of an already running session are **NOT supported yet**.
8. With separate telemetry consent, filtered events go to local queue files. A detached uploader delivers to the Worker, which writes into its D1 outbox. A 5-minute scheduled task forwards JSONL archives to the dedicated Diagnostics GitHub Release namespace.

## Deployment checklist (owner only)

Requires a Cloudflare account with Workers/D1, Node 22, and an optional fine-grained GitHub token for **only** `pilialvu75-hue/Ai-orchestrator-diagnostics` (Contents read/write, release creation/upload). **Never share tokens in chat, README, QR, installer, client logs or Git commits.**

1. `npm install && npm test && npm run check`
2. `npx wrangler login` (interactive owner-only Cloudflare authentication).
3. `npx wrangler d1 create beta-access`; replace `REPLACE_WITH_REAL_D1_DATABASE_ID` in `wrangler.toml` using the returned ID.
4. `npx wrangler d1 migrations apply beta-access --remote` (verify the selected account/database).
5. Generate a unique random 48+ character token locally. Save with `npx wrangler secret put ADMIN_TOKEN`.
6. Save the GitHub fine-grained token with `npx wrangler secret put DIAGNOSTICS_GITHUB_TOKEN`. Without it, telemetry is queued in D1 and **not sent** to Diagnostics.
7. `npm run deploy`; set `PUBLIC_BASE_URL` in `wrangler.toml` under `[vars]` to the actual HTTPS origin returned by deployment and deploy again. Configure Cloudflare Access/rate limiting before external tester invitations.
8. Open `<PUBLIC_BASE_URL>/admin/` in Android Chrome. Choose menu → Add to Home screen / Install app. **There is no native Android APK or background push notification at this stage.**
9. Verify the public landing `/d/wemuldroid`, QR `/qr/wemuldroid.svg`, admin login, a fake enrollment (on a safe development machine), approval/denial/duration, status expiration and the real Diagnostics GitHub Release contents.
10. **Only after verification**, build a new Windows pilot by setting `WEMULDROID_BETA_ACCESS_URL=<PUBLIC_BASE_URL>` for the Windows installer build. `WEmulDroid/installer/Build-Windows.ps1` then embeds `BETA_ACCESS_URL.txt` and the new launcher gate. Normal builds without the variable remain ungated. Follow the existing code-signing policy and run the official release workflow; do not misrepresent unsigned Windows builds as trusted. Do **not** overwrite an already deployed tester build merely to add the gate.

**Important:** the existing release `v0.9.0-beta.10` predates Beta Access. The QR will link to it until a new officially published release exists; it does not magically gain activation. Deploying the Worker and creating a new gated Windows release are separate owner-authorized stages.

## API / security properties

| Route | Purpose | Protection |
| --- | --- | --- |
| `GET /d/wemuldroid`, `/download/wemuldroid` | Landing and official installer redirect | Public; official GitHub API exact tag/asset/name matching |
| `GET /qr/wemuldroid.svg`, `/api/catalog` | QR SVG and verified beta metadata | Public |
| `POST /api/v1/enroll` | Request permission | 128-bit UUID plus 256-bit random device key; explicit user gesture |
| `GET /api/v1/status?installation_id=...` | Query approval/expiration | `X-Device-Key` HTTPS header |
| `POST /api/v1/telemetry` | Send allowlisted event | `X-Device-Key`, approved, telemetry consent, 500 events/day |
| `GET /api/admin/requests` | Owner inbox | `Authorization: Bearer <ADMIN_TOKEN>` |
| `POST /api/admin/requests/<uuid>/decision` | Approve (1–365 days), deny, revoke | Admin bearer; no embedded admin key in PWA |

The admin token is held only in page memory, never localStorage. Cloudflare Worker checks it against a deployed secret. No client-side gate can provide tamper-proof licensing against a determined administrator of the Windows PC; the objective is controlled testing, not DRM.

To limit abuse before sharing publicly, add an owner-protected Cloudflare Access policy and Cloudflare rate-limiting rules to sensitive endpoints; the D1 pending quota and telemetry quota are *not* a replacement for edge IP rate limits. The dashboard currently has no OS-level push or remote login recovery mechanism.

## Diagnostics (mandatory on each future test app)

Diagnostics are **opt-in per installation** and privacy-filtered before leaving the PC:
- Current implemented Windows launcher captures **APP_START, APP_EXIT, APP_ERROR**, 60-second **PERF_SAMPLE** events with **launcher CPU%, launcher RAM MiB, startup milliseconds, uptime seconds**; no free-form error messages. UI error reports contain code `WEMUL_UI_ERROR`.
- The existing manually collected ADB `logcat`, screenshots, traces and Android app details **remain local**, not uploaded.
- **Emulator process CPU/GPU, true FPS, actual I/O, network bandwidth and crash classification still need explicit instrumentation**. The schema already reserves numeric fields but does not invent values.
- Events reach the central Worker and are periodically archived to `pilialvu75-hue/Ai-orchestrator-diagnostics` using the dedicated release tag `diagnostics-wemuldroid-v1-<uuid>` and `wemuldroid-diag-<sha256>.jsonl` assets. The GitHub token exists **only** as a Cloudflare secret.
- The target Diagnostics repository is public: the only permissible fields are technical, sanitized, small bounded numbers, time, version, pseudonymous ID and a closed error code. Never include account data, logcat, credentials, filenames, screenshots, prompts or personal contents.

This telemetry delivery **must be verified end to end** before marking Diagnostics PASS. The client stores separate local JSON queue items until accepted by the Worker; the Worker stores an independent outbox until GitHub confirms upload. Neither confirmation is inferred from a successful HTTP connection alone.

## Outstanding pilot gates

- [ ] Cloudflare deployment and real HTTPS endpoint verified
- [ ] Installable Android PWA tested on Galaxy S24 FE
- [ ] Owner secret authentication and inbox tested from Android
- [ ] QR/link resolves to current release after a new release is published
- [ ] Tester WEmulDroid gated installer built, signed if possible, and run on separate Windows profile/device
- [ ] Deny, approve, expiry, revocation upon restart and offline fail-closed verified
- [ ] Diagnostics release/asset archived, rotated and read back (**upload and bounded rotation are implemented but not end-to-end tested**)
- [ ] Rate limiting and cloud access hardened before public invitations
- [ ] Independent Windows memory and performance regression tests

Proposals after pilot: native Android app, signed offline licenses with bounded expiry/revocation checks, FCM push notifications, direct email-provider integration, granular performance dashboards, metrics for emulator and GPU/FPS.
