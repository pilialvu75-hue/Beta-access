# AIVEXUS Beta Access

Central service for distributing private-test invitations, QR codes, and time-limited tester authorizations across AIVEXUS applications.

## Initial pilot

- **Administrator:** installable Android web app (PWA), with a future native Android app planned.
- **First test application:** [WEmulDroid](https://github.com/pilialvu75-hue/WEmulDroid), an Android emulator **running on Windows**.
- **Installation:** QR or shareable link to the latest **approved gated** Windows installer; historical ungated releases are intentionally blocked.
- **Access control:** the tester requests approval from inside a specially built application; the owner can approve, deny or revoke access for a selected number of days.
- **Diagnostics:** opt-in, privacy-filtered structured performance and error reports relayed to [AI-Orchestrator Diagnostics](https://github.com/pilialvu75-hue/Ai-orchestrator-diagnostics).

The beta service is **not yet deployed**. The public repository does not imply that an authorization server, Android APK, push notifications, signed Windows installer or automatic email delivery already exists.

Implementation is now in [Beta-access PR #1](https://github.com/pilialvu75-hue/Beta-access/pull/1) on the `feature/wemuldroid-pilot` branch. The Windows-only adapter remains in [WEmulDroid PR #8](https://github.com/pilialvu75-hue/WEmulDroid/pull/8), and the producer schema in [Diagnostics PR #3](https://github.com/pilialvu75-hue/Ai-orchestrator-diagnostics/pull/3).

**Do not publish live access credentials or secrets here.**
