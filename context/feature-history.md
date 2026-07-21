# Feature History

> Append-only record of completed features and fixes. Add a dated, concise entry after completion; do not edit, reorder, or remove earlier entries.

## Entries

### 2026-07-20 — Fire tablet native companion diagnostic spike

- Added a standalone API 28 Kotlin companion with a foreground service, Android Keystore-backed
  Lounge pairing persistence, redacted diagnostics, serialized playback commands, and guarded
  reconnect/session lifecycle behavior.
- Proved SmartTube TV-code pairing, open-video, play, pause, seek, playback-state reporting, and
  encrypted credential restoration after a controlled companion process interruption on the
  Amazon KFTRWI/trona Fire tablet.
- Validated the debug APK with 15 JVM tests and `assembleDebug`; independent review found no
  remaining blocking correctness or security issues. PocketBase integration and explicit Wi-Fi
  interruption testing remain deferred.

### 2026-07-20 — PocketBase native controller protocol

- Added separate controller-device enrollment/authentication, resumable monotonic sessions,
  validated/idempotent commands, atomic terminal acknowledgements, and sanitized state reporting
  in a pinned PocketBase 0.39.7 backend.
- Integrated the Fire tablet companion through HTTPS and PocketBase SSE wake hints with encrypted
  controller credentials/progress, authoritative refetch, ambiguous-send reconciliation, bounded
  reconnect, and preserved Lounge isolation.
- Passed real PocketBase authorization/concurrency/SSE integration, six backend contract tests, 31
  Android JVM tests, Android assembly, Vue unit/build validation, and an independent final review
  with no remaining actionable findings. Live deployment, enrollment, and tablet mutation remain
  approval-gated.

### 2026-07-21 — Party Lifecycle and Fair-Rotation Queue Request API

- Added versioned PocketBase party, temporary guest, karaoke-song eligibility/provenance, and queue
  schema plus server-only party join, sanitized queue, request, fair-start, and tablet transition
  routes. Codes and credentials are server-hashed; parties and guest access expire after 12 hours.
- Enforced deterministic requester rotation, direct-write/read boundaries, durable active-song
  uniqueness, rate limiting, idempotent transitions, and native-controller `open_video` handoff
  guarded by an active controller session.
- Passed pinned PocketBase 0.39.7 authorization, expiry, rate, race, rotation, transition, and
  controller-handoff integration coverage; backend contract tests; Vue tests; production build;
  and independent final security/concurrency review.
