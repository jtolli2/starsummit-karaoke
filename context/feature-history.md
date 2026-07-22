# Feature History

> Append-only record of completed features and fixes. Add a dated, concise entry after completion; do not edit, reorder, or remove earlier entries.

## Entries

### 2026-07-22 — Controller realtime authorization recovery

- Added a narrow native-companion recovery path for the retained staging PocketBase realtime
  subscription authorization mismatch: only an HTTP 403 while subscribing falls back to a
  two-second authenticated HTTPS command refetch loop. Other realtime failures keep the existing
  reconnect/error behavior.
- Added redacted endpoint/phase/fallback diagnostics and JVM coverage. The companion never exposes
  controller credentials, session material, or Lounge pairing data in logs or its UI.
- On retained staging, an isolated guest request was started through the normal tablet endpoint;
  the companion polled command sequence 63 and PocketBase marked its `open_video` command
  succeeded. A repeated tablet transition returned the server's idempotent `playing` result.

### 2026-07-21 — Tablet Operator Interface

- Added the touch-first `/tablet` operator experience with constrained `tablet_admin` sign-in,
  recoverable session/active-party restoration, explicit 12-hour party creation, QR join display,
  sanitized queue/controller state, and accessible guarded queue actions.
- Added tablet-only authoritative status and active-party recovery routes, a forward party-owner
  migration, expiry/monotonic transition protection, and a controller handoff guard that requires
  a fresh current-generation connected heartbeat before a queue entry can become playing.
- The browser never receives PocketBase superuser, controller-device, or Lounge material; playback
  remains an idempotent PocketBase command for the native controller. `/admin` was intentionally
  not added because `/tablet` is the single constrained operator/display surface.
- Passed focused Vue tests, backend protocol tests, production build, migration/hook syntax, and
  independent security/concurrency review. Pinned local PocketBase integration is environment
  gated; retained-staging live validation is recorded separately after delivery.

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

### 2026-07-21 — Guest Party Interface

- Added the responsive file-based `/party/[code]` guest experience with temporary party-scoped
  session credentials, sanitized queue states, eligible-song browse/search, and validated requests
  with clear duplicate, rate-limit, expiry, and loading/error feedback.
- Added a party-scoped, payload-free PocketBase SSE wake topic with strict temporary-credential
  authorization; all queue state is recovered through the existing authenticated HTTPS endpoint.
  Guests retain no tablet/admin controls or privileged credentials.
- Passed focused Vue tests, production type-check/build, PocketBase hook syntax checks, and final
  independent review. The local pinned-runtime integration harness was unavailable and skipped;
  validate custom wake delivery against it before any deployment validation.

### 2026-07-21 — Guest Party Interface staging delivery evidence

- Deployed exact commit `0de3c6f3c9f595b2942b3562e7a4554f9fe81c6e` to the retained
  `starsummit-pocketbase-test` Coolify application without replacing its persistent volume.
  Deployment health and public `/api/health` passed; unauthenticated guest API reads remained
  denied as designed.
- Live guest-page validation is blocked by the intentional container boundary not yet provisioned
  in Coolify: the retained PocketBase-only application returns 404 for `/party/<code>`. A separate
  frontend application/container with same-origin routing must be created before browser flow and
  live guest SSE validation can proceed.

### 2026-07-21 — Frontend Container and Same-Origin Routing

- Added a multi-stage Bun-to-Nginx frontend container with deep-link SPA fallback, strict missing
  static-asset 404 behavior, health checks, and a same-origin `/api` proxy. PocketBase realtime
  SSE is unbuffered with long read/send timeouts; forwarded scheme and client-chain handling are
  constrained for Coolify ingress.
- Added an approval-gated Coolify Compose topology: frontend is the only public service and
  PocketBase remains private with an explicitly selected pre-existing external data volume.
  Documented the production hostname and a non-mutating retained-staging plan.
- Passed Docker container integration coverage for static serving, deep routes, API proxying,
  realtime streaming, and built-asset secret scans; passed Vue unit tests, production build,
  Compose rendering, and independent final review. No commit, deployment, DNS/resource change,
  volume action, or retained staging mutation was performed.

### 2026-07-21 — Frontend Container staging delivery evidence

- Pushed `7f55f116cf4205fd52b57ab6a34184eeec7a3b0c`; redeployed the retained PocketBase staging
  application on its existing persistent volume with a stable private `pocketbase-staging` alias.
  Created the separate frontend staging application `f3b92sq9dy8y5ernb1nw9cfs` at
  `https://karaoke-test.app.starsummit.net`, proxying same-origin `/api` to that private alias.
- Coolify reported both applications healthy. HTTPS checks passed for `/healthz`, an SPA deep
  route, backend `/api/health`, a missing asset 404, and PocketBase realtime SSE. A browser loaded
  `/party/DEMO1234` and correctly rendered the backend-provided expired-party state. No backend
  records, persistent volume, controller enrollment, tablet state, production hostname, or
  deferred Wi-Fi interruption test was changed.
