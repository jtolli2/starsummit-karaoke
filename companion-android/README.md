# Starsummit Karaoke native companion

This is a standalone Kotlin Android app (`net.starsummit.karaoke.companion`) targeting
Android/Fire OS API 28 and arm64 devices. It has no Google Play Services dependency. In addition
to the local Lounge diagnostic, it contains the PocketBase native-controller bridge.

## Architecture

- `MainActivity` is a touch-friendly diagnostic surface for TV-code pairing and basic playback
  commands. It only displays redacted connection and now-playing state.
- `CompanionService` is a `START_STICKY` foreground service. It owns reconnect attempts and the
  active Lounge session, so the browser never receives Lounge credentials.
- `PairingStore` encrypts the screen ID, Lounge token, and screen name with an AES/GCM key held in
  Android Keystore. Private preferences contain only ciphertext and IV.
- `LoungeController` isolates the private YouTube Lounge transport. The implementation pairs at
  `pairing/get_screen`, refreshes at `get_lounge_token_batch`, binds a `REMOTE_CONTROL` session,
  consumes length-prefixed nested JSON-array events (retaining event IDs for AID), and exposes `setPlaylist`, `play`, `pause`,
  `seekTo`, and `getNowPlaying` through the `/api/lounge/bc/bind` request/form shape.
- `LoungeProtocol.kt` contains pure chunk parsing, event reduction, identifier validation, and
  bounded exponential backoff. These are covered by JVM unit tests.
- `PocketBaseControllerApi` uses HTTPS OkHttp calls for enrollment, controller-device
  auth-with-password, expiring session start/resume, command fetch, terminal acknowledgement,
  and sanitized state reporting. Paths and DTO parsing are centralized for server evolution.
- `ControllerBridge` treats PocketBase realtime SSE as a wake hint: it parses `PB_CONNECT`, posts
  an authorized `controller_commands/*` subscription, then refetches commands over HTTPS after
  every connection/reconnect. `ControllerCommandProcessor` validates convergent commands and
  durably tracks sequence/in-flight identity so duplicate or interrupted delivery is reconciled
  against a sanitized `PlaybackSnapshot` before replay.
- `ControllerStore` uses a dedicated Android Keystore AES/GCM key and preferences namespace for
  controller credentials, sessions, and progress. It is separate from `PairingStore`; secret
  values have redacted `toString()` representations and are never rendered in diagnostics.

## Build and run

From this directory, use the checked-in Gradle wrapper:

```sh
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

Launch the resulting local APK on an API 28-compatible Fire tablet only after reviewing the APK
path and receiving explicit approval for installation. This spike intentionally does not include
an install script, ADB commands, or remote deployment.

## Security and private protocol risk

HTTPS is required and cleartext traffic is disabled. The launcher Activity is the only exported
component; the service is not exported. Android backups are disabled. Pairing tokens are never
logged, shown in the UI, included in diagnostics, or sent to PocketBase. TV codes and YouTube IDs
are validated before transport; SmartTube TV codes may include display spaces or hyphens but must
normalize to exactly 12 digits.

YouTube Lounge is a private, undocumented protocol and may change without notice. Endpoint
shapes, event names, and state semantics must be re-verified against the current SmartTube build
before treating this diagnostic as production-ready. No GPL implementation was copied; the
transport is intentionally a small replaceable seam. Reconnect uses bounded exponential backoff
after IO/session failures and refetches the token before binding again.

PocketBase realtime is Server-Sent Events (`GET /api/realtime`, `PB_CONNECT`, then authorized
`POST /api/realtime` subscription), not a WebSocket command queue. A command event carries no
authority; it only wakes the bridge to perform an authoritative HTTPS fetch.

An expired/non-resumable persisted controller session is retried once as a fresh session. Lounge
I/O/session-unavailable failures are treated as ambiguous delivery: the command stays in-flight,
no terminal failure acknowledgement is sent, and the bridge reconnects/refetches. On redelivery
the companion requests fresh now-playing state before deciding whether a convergent replay is
needed. In-flight progress is synchronously committed before any Lounge playback request.
