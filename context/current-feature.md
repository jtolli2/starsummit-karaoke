# Fire Tablet Native Companion Diagnostic Spike

> Working record for the single active feature or fix. Keep its status, goals, and implementation notes current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Reconcile the architecture so a native Fire tablet companion, rather than browser code, owns
  YouTube Lounge credentials and privileged SmartTube playback control.
- Add an isolated Kotlin Android application under `companion-android/` that targets the verified
  Fire OS 7 / Android 9 (API 28), arm64-v8a tablet without Google Play Services.
- Produce an installable local diagnostic build with a foreground service and a touch-friendly
  screen for SmartTube TV-code pairing, connection state, open-video, play, pause, and seek.
- Persist pairing credentials with Android Keystore-backed encryption and never expose them in
  browser clients, logs, diagnostics, or exported Android components.
- Recover the Lounge session after transient Wi-Fi loss and process interruption, with observable
  connection/playback diagnostics.
- Keep PocketBase integration out of the spike until Lounge control is proven locally.

## Notes

- Target verified read-only device profile: Amazon KFTRWI (`trona`), Fire OS 7, Android 9/API 28,
  arm64-v8a, 1200x1920, approximately 6.2 GB free.
- The companion is a separate native module; it does not replace the guest Vue app or put Lounge
  access into `/tablet` browser code.
- No Google Play Services dependency. Prefer Android platform APIs plus small JVM libraries.
- The Lounge API is private and may change. Keep its transport and protocol parsing isolated behind
  a small interface, surface protocol failures in diagnostics, and do not couple it to PocketBase.
- TV-code pairing must retain only the resulting durable pairing material. Pairing tokens are
  sensitive and must be encrypted at rest through Android Keystore.
- Do not commit, push, deploy, delete, mutate Coolify, or change tablet state. APK installation and
  any other tablet mutation require separate explicit approval after identifying the APK and target.
- Open proof questions: current SmartTube compatibility with controller-side TV-code pairing,
  durable token refresh behavior, exact state events, and reconnect behavior after Wi-Fi/process loss.
- Implemented the standalone diagnostic app in `companion-android/`: API 28 Kotlin application,
  touch controls, `START_STICKY` foreground service, isolated Lounge transport, nested event parser,
  playback diagnostics, bounded reconnect, and no PocketBase or Google Play Services integration.
- Pairing material is AES/GCM encrypted with a non-exportable Android Keystore key; private
  preferences contain only ciphertext and IV. Android backup and cleartext traffic are disabled,
  and the service is not exported.
- Lounge session commands are serialized. Session generation and atomic close guards prevent stale
  or queued commands from controlling a previous TV after re-pairing, and reconnect refetches
  now-playing state after a successful bind.
- Local validation: JDK 21 + Android SDK Gradle `testDebugUnitTest assembleDebug` passed with 15
  tests and no failures. Final debug APK: `companion-android/app/build/outputs/apk/debug/app-debug.apk`
  (8,739,477 bytes; SHA-256
  `82dad5af72e3e6f6832b57c095630fbed3234a20c75bb9bfb119643417d0e708`). Generated outputs are
  ignored and are not present in Git status.
- Independent final review found no remaining blocking correctness or security issues. SmartTube
  compatibility remains unproven until an approval-gated APK installation and local TV-code test.
- With explicit approval on 2026-07-20, installed the reviewed debug APK over USB ADB on Amazon
  KFTRWI/trona serial `G8S1KT06151705SM` using package replacement. Android reported success and
  confirmed `net.starsummit.karaoke.companion` versionCode 1, minSdk 28, targetSdk 28. The app was
  then launched with separate explicit approval. Android confirmed `.MainActivity` resumed and
  `.CompanionService` running in the foreground with notification ID 1001. Lounge pairing,
  credential persistence, and playback commands were initially unexercised.
- With separate explicit approval, submitted the temporary SmartTube TV code to the diagnostic
  pairing flow. The redacted UI reported `CONNECTED`, reconnect attempt 0, and incoming `noop`
  Lounge events. The foreground service remained active and the private app data contained the
  expected `lounge_pairing.xml` preferences file; credential contents were not inspected or exposed.
  A transient historical `IOException` remained visible after recovery. No open-video, play, pause,
  seek, or other playback command had been sent at that point.
- With separate explicit approval, sent Lounge `setPlaylist` for YouTube video `WEuuVs4SrSA`.
  SmartTube accepted the command and the redacted diagnostic reported the same video ID, player
  state 1 (playing), position 0.0 seconds, and duration 152.0 seconds while remaining `CONNECTED`
  with reconnect attempt 0. This proves TV-code pairing and native open-video playback locally.
  With another explicit approval, pause changed the reported player state to 2 at 83.4 seconds,
  seek moved the paused player to exactly 30.0 seconds, and resume returned state 1 at that
  position. This proves native open-video, play, pause, seek, playback-state, and connection
  diagnostics locally.
- With another explicit approval, force-stopped only the companion package and confirmed its
  process and foreground service were absent. Relaunching restored the encrypted pairing without a
  TV code, re-established `CONNECTED` with reconnect attempt 0 and no current error, refetched the
  same playing video at 34.4 seconds, and restarted foreground notification ID 1001 in process
  18990. This proves credential persistence and recovery after a controlled process interruption.
  A Wi-Fi interruption remains untested.
