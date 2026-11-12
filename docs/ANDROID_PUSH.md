# Android push + WEmulDroid automatic activation

## Expected flow

1. Windows WEmulDroid gated beta is installed normally.
2. At first launch, tester presses "Richiedi autorizzazione". The program remains locked.
3. The owner receives an opt-in Android Web Push notification, including with PWA closed if Android permits. Tapping it opens the admin PWA to decide with passkey.
4. WEmulDroid checks status automatically while its gate is open (roughly every 8 seconds), and unlocks once server says approved and unexpired. There is no manual "Controlla stato" button.
5. On later launches, the gated build checks the server again. Revocation during an already-running session is not immediate in this first pilot.

## One-time push bootstrap (independent Cloudflare account only)

After GitHub CI has passed and the central Worker has been deployed, go to **GitHub → Beta-access → Actions → Initialize Android Web Push (one-time) → Run workflow**, confirm the account and run. The workflow reads only BETA_CF_API_TOKEN and BETA_CF_ACCOUNT_ID, generates a P-256 VAPID pair, saves VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT as Cloudflare Worker secrets and NEVER prints the private key. It refuses to regenerate if any VAPID secret already exists, preventing unintentional rotation.

Then on the Samsung S24 FE open https://aivexus-beta-access.aivexus-lab.workers.dev/admin/ in Chrome or the installed PWA, authenticate with fingerprint, tap **Attiva notifiche push** and permit Android notifications. To test actual background delivery, lock the phone and send a controlled request from a gated WEmulDroid beta.

## Security

- Push subscriptions are accepted only for an authenticated administrator. No private tester details appear in a lock-screen notification.
- Outbound HTTPS delivery is restricted to known Google FCM, Mozilla and Apple Web Push endpoints, not arbitrary URLs or local networks.
- A maximum of five admin device subscriptions; expired (404/410) endpoints are pruned.
- The notification outbox retries deliveries, expiring entries after 24 hours; push remains best-effort and may be delayed by OS/network/battery limits.
- No public QR/installer distribution until a separately gated Windows beta has passed its physical and Diagnostics tests.
- Current Windows gate uses a 5-second network timeout and an approximately 8-second UI timer; test responsiveness under unstable connectivity. A later improvement should replace synchronous requests with an asynchronous worker.

## Scope

This first step implements push for the existing Android PWA, not a native Android APK. No new Firebase account is required. Windows unlock is driven by authenticated server status checks, not by notifications sent to the Windows process.
