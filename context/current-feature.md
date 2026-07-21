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
- Signed `8f8ca38` deployed successfully and the repaired APK resumed generation 2 without a crash.
  Live PocketBase commands then proved SSE-triggered authoritative refetch, strict monotonic
  sequencing, and terminal success acknowledgements for `get_now_playing` (5), `play` (7), `pause`
  (8), and final `play` (10). Sanitized state advanced to sequence 10 for video `WEuuVs4SrSA`,
  connected and playing. Parameterized `open_video` (6) and `seek` to 30 seconds (9) reached the
  companion but did not converge through Lounge before their 30-second expiries; PocketBase marked
  both failed with `expired` and state remained near 24.7 seconds. No Wi-Fi interruption was run.
- Signed `a571658` was pinned and deployed to the existing healthy Coolify application without
  changing its persistent storage, and the matching APK resumed the enrolled generation-2 device.
  Live PocketBase sequences 13 (`get_now_playing`), 15 (`pause`), and 17 (`play`) reached terminal
  success ACKs. Sequence 14 used the valid video ID `WEuuVs4SrSA`; it expired without an ACK, but
  sanitized state subsequently reported that exact video playing, proving SmartTube applied the
  command while the Lounge response remained ambiguous. Sequence 16 (`seek` to 30 seconds) likewise
  expired without an ACK.
- The follow-up local repair correlates ambiguous delivery with the playback revision captured before
  dispatch. That marker survives controller-loop reconnects, while timeout reconciliation accepts
  only a newer authoritative playback observation; absent or pre-dispatch cached state cannot produce
  a success ACK. The focused suites pass 37 controller and 19 Lounge tests, debug APK assembly passes,
  and independent review found no remaining issue. Delivery and renewed live validation require
  separate approval.
- Signed `a1b9b53` deployed successfully and the matching APK resumed the existing device. Live
  sequences 18 (`get_now_playing`), 20 (`pause`), and 22 (`play`) succeeded, while `open_video` 19
  and paused `seek` 21 were applied by SmartTube but expired without ACKs. Final sanitized state
  reported `WEuuVs4SrSA` playing near 34 seconds, proving both parameterized intents converged.
  Investigation found that same-command replay replaced its original dispatch revision before
  redelivery reconciliation.
- The next local repair scopes correlation by command ID and idempotency key. Recreated executors and
  retries of the same command retain the original revision; a different command installs a fresh
  marker, and process restart has no marker and cannot trust cached state. The exact suites pass 38
  controller and 19 Lounge tests, debug APK assembly passes, and independent review approves the
  lifecycle and false-ACK behavior. Delivery requires fresh approval.
- Signed `682e417` deployed successfully and the matching APK resumed generation 2. Live
  `get_now_playing` 23, `pause` 26, and `play` 28 succeeded. Actual video-transition commands 24 and
  25 and paused `seek` 27 still expired without ACKs: the parameter POST consumed about 15 seconds,
  then deferred controller/Lounge teardown and redelivery exhausted the remaining command lifetime.
- The next local repair performs correlated playback refresh immediately after an ambiguous transport
  response, before reconnecting, and ACKs only a newer authoritative state that converges. PocketBase
  HTTP calls now remain cancellation-aware through response-body reads; ACKs are bounded by remaining
  command lifetime, and uncertain ACKs restore the prior sequence plus in-flight identity. The exact
  suites pass 43 controller and 19 Lounge tests, the stalled-body cancellation test passes three fresh
  isolated runs, debug APK assembly passes, and independent review approves the result. Delivery and
  renewed live validation require fresh approval.
- Signed `b98fe15` deployed successfully and its APK resumed generation 2, but actual transition
  commands 30 and 31 and `seek` 33 still expired while `get_now_playing` 29, `pause` 32, and `play`
  34 succeeded. Sanitized state remained `WEuuVs4SrSA` near 152 seconds, isolating the remaining
  defect below controller reconciliation in the Lounge command wire shape.
- Maintained Lounge sender implementations include `CI=0`, `TYPE=bind`, and `t=1` on command POSTs;
  the companion omitted them. The next local repair adds those command-only query fields and the
  complete `setPlaylist` sender form while leaving subscription polling, sender identity, and token
  placement unchanged. The exact suites pass 43 controller and 19 Lounge tests, debug assembly
  passes, and independent review approves the protocol shape. Delivery requires fresh approval.
- Signed `0d30488` deployed successfully and its APK resumed generation 2, but transition commands
  36 and 37 and `seek` 39 still expired while commands without parameter payloads succeeded. The
  remaining maintained-sender mismatch was session sequencing: the companion paired first command
  `RID=2` with `ofs=0`, while working senders start at `RID=2`/`ofs=1` and advance both together.
- The next local repair initializes Lounge command offset at 1 and tests FIFO pairs `RID=2`/`ofs=1`
  then `RID=3`/`ofs=2`. The exact suites pass 43 controller and 19 Lounge tests, debug assembly
  passes, and independent review approves the state alignment. Delivery requires fresh approval.
- Signed `d5cc8c9` deployed successfully and its APK resumed generation 2, but transition commands
  42 and 43 and `seek` 45 still expired while non-parameterized commands succeeded. Offset alignment
  therefore did not resolve the receiver rejection.
- The next local diagnostic adds asynchronous, redacted Lounge command telemetry containing only the
  allowlisted action, RID/OFS, elapsed time, and outcome category. It never records URLs, credentials,
  session/screen identifiers, form values, video/seek payloads, response bodies, or exception messages.
  A dedicated daemon executor isolates telemetry from transport latency. The exact suites pass 43
  controller and 21 Lounge tests, debug assembly passes, and independent review finds no issue.
  Delivery is required to capture the actual live HTTP outcome before another protocol change.
- Signed `7c79474` deployed successfully and reproduced expired `open_video` 48 and `seek` 50, but
  Fire OS suppressed the app's `DEBUG`-priority telemetry in every log buffer. The local diagnostic
  now emits the same redacted records at `INFO`; no fields or transport behavior changed. The exact
  suites and debug assembly pass. Delivery is required to capture the outcome.
- Signed `1560206` deployed successfully. Redacted Lounge telemetry for sequences 51–53 contained
  only two successful `getNowPlaying` transports (`RID=2`/`ofs=1` and `RID=3`/`ofs=2`); neither
  failed `open_video` command reached Lounge at all. This moves the remaining defect upstream to
  PocketBase realtime notification or authoritative refetch/processing.
- The next local diagnostic logs only safe controller lifecycle facts at `INFO`: connection attempts,
  subscription acceptance, sanitized event names, refetch command counts, and an explicit allowlist
  of error categories. Unknown strings map to `ControllerFailure`; callbacks are asynchronous and
  noninterfering. The exact suites pass 45 controller and 21 Lounge tests, debug assembly passes, and
  independent review approves the redaction boundary. Delivery is required to capture the lifecycle.
- Signed `5ed7124` deployed successfully and its diagnostic APK resumed generation 2. A minimal live
  run proved `get_now_playing` 54 reached Lounge and succeeded, while `open_video` 55 triggered an SSE
  wake followed by `ControllerProtocolException`, reconnect, and eventual expiry without any Lounge
  transport attempt. This isolates parameterized-command failure to authoritative PocketBase command
  materialization/parsing before controller execution, rather than the Lounge wire.
- PocketBase's native JSON field wrapper can appear non-empty to hook JavaScript without exposing
  payload properties normally. The local repair makes `jsonField` prefer PocketBase's canonical
  serialized JSON and normalize native-object fallbacks. The real PocketBase 0.39.7 integration test
  now asserts `videoId` and `seekSeconds` survive both command creation and authoritative device
  refetch; it passes with the repair. Delivery and renewed live validation require fresh approval.
- Signed `8a2d5c5` deployed healthy with persistent storage unchanged. Live PocketBase sequences 56–62
  all received terminal success ACKs in strict order: `get_now_playing`, `open_video` for
  `WEuuVs4SrSA`, `play`, `pause`, `seek` to 30 seconds, `play`, and a final state refresh. Redacted
  tablet telemetry proved an SSE event and authoritative one-command refetch for every intent, then
  successful Lounge transports for `setPlaylist`, `play`, `pause`, `seekTo`, and state reads with
  advancing RID/OFS pairs. Final sanitized generation-2 state was connected, playing
  `WEuuVs4SrSA` at 30.061 seconds with duration 152 and last command sequence 62. The payload
  materialization defect is resolved end to end; no Wi-Fi interruption or resource deletion occurred.
