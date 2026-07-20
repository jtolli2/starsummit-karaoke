# Starsummit Karaoke native companion

This is a local diagnostic spike for the Fire tablet controller. It is a standalone Kotlin
Android app (`net.starsummit.karaoke.companion`) targeting Android/Fire OS API 28 and arm64
devices. It has no Google Play Services dependency and does not talk to PocketBase yet.

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
