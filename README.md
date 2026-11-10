# AIVEXUS Beta Access

Central service for distributing private-test invitations, QR codes, and time-limited tester authorizations across AIVEXUS applications.

## Initial pilot

- **Administrator:** installable Android web app (PWA), with a future native Android app planned.
- **First test application:** [WEmulDroid](https://github.com/pilialvu75-hue/WEmulDroid), an Android emulator **running on Windows**.
- **Installation:** QR or shareable link to the latest verified official Windows installer.
- **Access control:** the tester requests approval from inside a specially built application; the owner can approve, deny or revoke access for a selected number of days.
- **Diagnostics:** opt-in, privacy-filtered structured performance and error reports relayed to [AI-Orchestrator Diagnostics](https://github.com/pilialvu75-hue/Ai-orchestrator-diagnostics).

The beta service is **not yet deployed**. The public repository does not imply that an authorization server, Android APK, push notifications, signed Windows installer or automatic email delivery already exists.

The previous prototype lives temporarily in [WEmulDroid PR #8](https://github.com/pilialvu75-hue/WEmulDroid/pull/8), pending extraction into this repository. **Do not publish live access credentials or secrets here.**
