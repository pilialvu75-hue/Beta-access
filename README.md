# AIVEXUS Beta Access

Central service for distributing private-test invitations, QR codes, and time-limited tester authorizations across AIVEXUS applications.

## Initial pilot

- **Administrator:** installable Android web app (PWA), with a future native Android app planned.
- **First test application:** [WEmulDroid](https://github.com/pilialvu75-hue/WEmulDroid), an Android emulator **running on Windows**.
- **Installation:** QR or shareable link to the latest **approved gated** Windows installer; historical ungated releases are intentionally blocked.
- **Access control:** the tester requests approval from inside a specially built application; the owner can approve, deny or revoke access for a selected number of days.
- **Diagnostics:** opt-in, privacy-filtered structured performance and error reports relayed to [AI-Orchestrator Diagnostics](https://github.com/pilialvu75-hue/Ai-orchestrator-diagnostics).

## Operational checkpoint — 13 November 2026

- **Worker:** deployed through the dedicated Cloudflare Beta Access account; [manual GitHub Actions run #43497986595](https://github.com/pilialvu75-hue/Beta-access/actions/runs/43497986595) finished successfully on main (including D1 migrations). This proves the deployment job, **not** the real Windows-to-Diagnostics path.
- **Galaxy administrator:** installed Android PWA; passkey, D1 and push configuration have been exercised by the owner. The owner-only Diagnostics permission probe in [PR #19](https://github.com/pilialvu75-hue/Beta-access/pull/19) is read-only, not proof of an uploaded GitHub asset.
- **Windows:** gated `v0.9.0-beta.11` installer compiles in the isolated [WEmulDroid PR #8](https://github.com/pilialvu75-hue/WEmulDroid/pull/8) CI. This unsigned CI artifact is **not** a public release, not installed/verified on the external Windows 11 tester, and may be blocked by Smart App Control. Never ask testers to disable security.
- **Distribution:** generic QR/download and public enrollment remain closed by design; the invite-only pilot has a separate **explicit manual enablement** step. A named invitation alone never authorizes a download or unlock.
- **Diagnostics:** simulated relay regression tests cover GitHub release/upload/acknowledgement/failure behavior without network access or real data. Real opt-in telemetry publication and read-back remain **PENDING**.

For a real relay test without Windows, use the **separate, explicitly opt-in manual workflow** documented in [Diagnostics real probe](docs/DIAGNOSTICS_REAL_PROBE.md). It can publish one anonymous synthetic event to the public Diagnostics GitHub repository and is never started by CI or deployment.

See [weekend private pilot](docs/WEEKEND_PRIVATE_PILOT.md), [first distribution issue #2](https://github.com/pilialvu75-hue/Beta-access/issues/2), and [private invitations](docs/PRIVATE_TESTER_INVITES.md). Beta Access does **not** ship a native Android APK, signed Windows installer, or automatic email sending. Its Android administrator client is a PWA.

The Windows-only adapter remains in [WEmulDroid PR #8](https://github.com/pilialvu75-hue/WEmulDroid/pull/8); the Diagnostics producer schema was integrated in [Diagnostics PR #3](https://github.com/pilialvu75-hue/Ai-orchestrator-diagnostics/pull/3).

**Do not publish live access credentials or secrets here.**
