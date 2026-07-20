# PocketBase Native Controller Protocol

> Working record for the single active feature or fix. Keep its status, goals, and implementation
> notes current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Add a versioned PocketBase schema and server routes for a native-controller protocol with a
  device auth collection that is separate from browser `tablet_admin` accounts, operator-created
  single-use enrollment grants, revocation, and expiring/resumable controller sessions.
- Restrict command creation to authenticated `tablet_admin` users and command consumption,
  acknowledgement, and state reporting to the enrolled device and its current session. Deny direct
  collection writes and prevent guest or cross-device access.
- Support only the approved convergent command set (`open_video`, `play`, `pause`, `seek`, and
  `get_now_playing`) with validated payloads, per-device monotonic sequence numbers, unique
  idempotency keys, explicit expiry, and terminal success/failure acknowledgement semantics.
- Add the smallest Android companion bridge that authenticates as a controller device, maintains
  encrypted PocketBase credentials separately from Lounge pairing material, consumes commands over
  PocketBase's HTTP + Server-Sent Events realtime protocol, and reports only sanitized state.
- Bound reconnect attempts with backoff, always refetch authoritative commands after reconnect,
  reject stale sessions, and reconcile duplicate or interrupted commands against current playback
  state before replaying an absolute/idempotent Lounge operation.
- Add automated tests for enrollment and authorization boundaries, invalid payloads, duplicate and
  replayed commands, acknowledgement/state transitions, stale sessions, and reconnect/refetch
  behavior. Run the Vue build/tests and Android unit tests/assembly without installing an APK or
  changing any live service or device.
- Correct in-scope architecture documentation to describe PocketBase realtime as SSE rather than
  WebSockets and document the controller credential/data boundary without adding queue or
  fair-rotation behavior.

## Notes

- Baseline is signed local `main` commit `3b25ecfc9e689655b48233650c1aaa502f858f34`;
  the working tree was clean when this feature started.
- The proven Lounge transport, encrypted Lounge `PairingStore`, command serialization, and
  generation guards remain isolated and unchanged unless a narrowly required adapter seam is
  needed.
- PocketBase persists approved command intents and sanitized observed state only. Lounge tokens,
  Google cookies, YouTube API keys, and direct Lounge request capabilities remain exclusively on
  the native device.
- PocketBase realtime is an SSE notification hint, not a command queue or source of truth. On every
  connection the companion receives `PB_CONNECT`, authorizes subscriptions with the returned client
  ID, and refetches commands over HTTPS; disconnects and missed events are expected.
- Exactly-once external playback is not possible across a process/network failure. The protocol is
  at-least-once with durable command identity, terminal acknowledgements, and reconciliation before
  replay; every supported command expresses an absolute or convergent target.
- Enrollment grant creation is an operator-only local/server administration action and is not
  exposed to Vue. This implementation will not create a grant, account, or session in any live
  PocketBase instance.
- Added a PocketBase 0.39.7 backend under `pocketbase/` with a pinned container, versioned schema,
  operator enrollment-grant route, separate controller-device auth, resumable monotonic sessions,
  atomic command/acknowledgement/state transitions, and own-device SSE rules. Direct collection
  writes remain disabled.
- Added the native Android bridge without changing the proven Lounge transport. Controller
  credentials, session identity, and in-flight progress use a distinct Android Keystore key and
  synchronous encrypted persistence; ambiguous playback sends remain pending until a newer
  authoritative Lounge state event permits reconciliation.
- Reconnect uses bounded backoff, preserves in-flight identity across ordinary outages, retries an
  expired session once as a fresh monotonic generation, subscribes using PocketBase's real
  `PB_CONNECT` SSE flow, and refetches pending commands over HTTPS after every connection or event.
- Validation passed on the final tree: six pure backend contract tests; one real PocketBase 0.39.7
  integration test covering authorization, enrollment replay, idempotency, competing ACKs, stale
  sessions, state, and actual SSE create/update delivery; 31 Android JVM tests (16 controller and
  all 15 Lounge regressions); Android `assembleDebug`; `bun test:unit --run`; and `bun run build`.
- Independent security/concurrency review initially found session-expiry, ambiguous-send,
  transaction, persistence, and reconciliation failure windows. Those findings were repaired and
  the final re-review approved the complete tracked and untracked tree with no actionable P0-P3
  findings.
- Live PocketBase/Coolify deployment, enrollment, APK installation, and tablet validation remain
  deliberately unperformed and require new explicit approval. A real Wi-Fi interruption remains
  untested on the Fire tablet.
- No commit, push, deployment, deletion, Coolify mutation, APK installation, or tablet mutation is
  authorized for this feature.
- Live validation on 2026-07-20 deployed signed `a83148e` (`allow empty controller command
  payloads`) to the temporary Coolify controller instance without replacing its persistent data.
  The incremental migration accepted an empty-payload `get_now_playing` command, confirming the
  original PocketBase required-field defect is fixed in the deployed service.
- Live delivery is blocked by a companion defect: the realtime SSE reader lets
  `okhttp3.internal.http2.StreamResetException: stream was reset: CANCEL` escape
  `OkHttpRealtimeConnection.stream` (`ControllerBridge.kt:336`). The exception kills the foreground
  service process. A controlled, approved force-stop/relaunch reproduced it twice; after the second
  crash Fire OS scheduled the service restart for 30 minutes. The persisted command therefore stays
  pending and cannot be used as acknowledgement/state evidence. No Wi-Fi interruption was performed.
- The approved follow-up repair converts only normal realtime EOF and `IOException` body failures
  into the existing closed-stream signal; coroutine cancellation and unexpected failures propagate.
  Focused controller tests cover the stream-reset, closed-signal, cancellation, and unexpected-error
  paths. Deployment and renewed live validation are pending this repair's approved delivery.
- The repaired APK renewed controller session generation 2 without another stream-reset crash, but
  a live generation-2 `get_now_playing` command expired without refetch or acknowledgement. Local
  PocketBase 0.39.7 integration still proves authenticated subscription and create/update delivery,
  so the approved diagnostic build adds attempt-scoped, redacted telemetry for subscription
  acceptance, SSE event labels, authoritative refetch counts, and sanitized refetch failure classes.
  It never records auth headers, tokens, command/event payloads, or Lounge material.
- Live redacted telemetry proved subscription acceptance and `PB_CONNECT`, then showed a
  `ControllerProtocolException` immediately after a generation-2 command wake/refetch. PocketBase
  serializes command expiry as `YYYY-MM-DD HH:mm:ss.SSSZ`; the Android command parser accepted only
  numeric epochs or strict ISO instants with a `T`. The local follow-up parser fix accepts the pinned
  PocketBase UTC format with strict calendar validation while preserving expiry boundaries, numeric
  epochs, and ISO timestamps. The focused controller suite passes 32 tests; delivery and renewed live
  command validation require separate approval.
