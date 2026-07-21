# Agent Workflow Feedback

> Append-only log of feedback and verified improvements to agent execution. Record the date, observed issue or suggestion, the resulting workflow change, and any follow-up needed; do not alter earlier entries.

## Entries

### 2026-07-21 — Make controller liveness a transactional precondition

- **Feedback:** A nominal controller session plus a stale `connected` state could make an operator
  start a song after the native companion had silently disappeared.
- **Improvement:** Treat a bounded controller heartbeat as part of both the sanitized status model
  and the same transaction that moves a queue entry to playing and creates its command. Test the
  stale-state/no-mutation path independently.
- **Follow-up:** Validate the heartbeat timeout against the retained staging controller without the
  deferred Wi-Fi interruption test.

### 2026-07-19 — Clarify implementation security and routing boundaries

- **Feedback:** The guidance left runtime ownership, browser admin credentials, guest queue writes, party access, and router generation ambiguous or contradictory.
- **Improvement:** Documented separate frontend/PocketBase containers, same-origin Coolify `/api` routing, coded party URLs, a constrained `tablet_admin` application account, a validated queue-request endpoint, and `vite-plugin-pages` file routing.
- **Follow-up:** Keep the SmartTube control spike open until it is investigated separately.

### 2026-07-20 — Treat realtime stream failures as recovery-path test inputs

- **Feedback:** Unit and integration coverage proved normal PocketBase SSE delivery but did not
  exercise an exception thrown while the Android HTTP/2 SSE body is being read. On the Fire tablet,
  `StreamResetException: CANCEL` escaped the reader coroutine and killed the foreground service.
- **Improvement:** For the next controller repair, catch stream-body failures at the realtime
  connection boundary, route them through bounded reconnect/refetch, and add a regression test that
  injects a throwing stream reader and verifies the service remains alive and retries.
- **Follow-up:** Rebuild, reinstall, and repeat the approved live command/state validation after a
  separately approved corrective commit and deployment.

### 2026-07-20 — Verify HTTP behavior at the wire boundary

- **Feedback:** An application-interceptor test suggested that the realtime subscription lacked an
  explicit JSON content-type header, but OkHttp already derives that wire header from the request
  body's media type. The proposed change was behaviorally redundant.
- **Improvement:** Test serialized requests at the network boundary or against the pinned PocketBase
  runtime before treating application-interceptor headers as proof of wire behavior. For live-only
  delivery failures, add redacted phase telemetry that distinguishes subscription, SSE receipt, and
  authoritative refetch without logging credentials or payloads.
- **Follow-up:** Use the diagnostic APK to isolate the first phase that fails on the Fire tablet.

### 2026-07-21 — Validate PocketBase hook callbacks in their worker VM

- **Feedback:** A new hook passed syntax checks but its route callbacks relied on top-level lexical
  helpers. PocketBase serializes callback code into worker VMs, producing opaque generic HTTP 400
  failures rather than a useful server stack.
- **Improvement:** Follow the proven controller-hook pattern: reload the hook within every route
  callback and resolve all helper functions and constants through an explicit `globalThis` contract.
  Run at least one real pinned-runtime route test before treating hook logic as functional.
- **Follow-up:** Keep real-runtime tests comprehensive enough to catch concurrency and auth paths,
  not just route initialization.

### 2026-07-21 — Treat credential and SSE recovery as first-class UI behavior

- **Feedback:** Initial guest-page tests did not expose stale temporary credentials, duplicate
  pending request retries, repeated SSE frame parsing, or hook continuation after wake publication.
- **Improvement:** Add focused recovery tests and independent review for temporary-credential
  rejoin, complete SSE frame consumption, bounded reconnect, and `finally`-protected hook
  continuation whenever a feature adds browser realtime state.
- **Follow-up:** Exercise the custom guest wake topic in the pinned PocketBase runtime before
  relying on it in deployment validation.
