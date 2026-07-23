# Agent Workflow Feedback

> Append-only log of feedback and verified improvements to agent execution. Record the date, observed issue or suggestion, the resulting workflow change, and any follow-up needed; do not alter earlier entries.

## Entries

### 2026-07-23 — Never clear a PocketBase composite unique key to blank

- **Feedback:** The first queue completion succeeded, but every later completion or failure returned
  a generic 409. PocketBase validated the composite unique `(party, active_song_key)` constraint
  before SQLite NULL semantics applied, so the first terminal blank value blocked all later
  terminal rows in the party.
- **Improvement:** Release active video identity with a per-record non-video terminal sentinel
  (`terminal:<queue-id>`) rather than `null` or an empty string. Validate at least two terminal
  transitions in the same party and re-request the released video ID.
- **Follow-up:** Keep unexpected transaction details server-side and return only normalized error
  codes to constrained clients.

### 2026-07-22 — Persist Coolify CLI and YouTube backup-key operating rules

- **Feedback:** The preferred Coolify CLI workflow and the newly configured backup YouTube API key
  were not present in durable project guidance.
- **Improvement:** Prefer the Coolify CLI for supported operations, retain the MCP as a read-only
  discovery/verification path, and use direct API calls only for CLI gaps. Treat
  `YOUTUBE_API_KEY_BACKUP` as a server-only fallback after definitive primary quota exhaustion with
  separate non-secret quota accounting and no ambiguous retry.
- **Follow-up:** Implement and validate backup-key selection before relying on it during a party;
  the current PocketBase hook reads only `YOUTUBE_API_KEY`.

### 2026-07-22 — Defer automated backup-key failover from the MVP

- **Feedback:** The party rehearsal needs a reliable primary-key path sooner than the broader
  alias-scoped failover design can be safely delivered.
- **Improvement:** Keep both credentials server-only, use the primary at runtime, and reserve the
  backup for manual development intervention until automated failover is implemented as a dedicated
  enhancement with durable per-alias accounting and real-runtime evidence.
- **Follow-up:** Do not imply automatic backup use in MVP operational documentation.

### 2026-07-22 — Review resumable import invariants as an adversarial sequence

- **Feedback:** Initial importer unit tests and syntax checks missed hook-VM closure use,
  frontend/backend response drift, replays that reset curation, and out-of-order chunk completion.
- **Improvement:** For any catalog batch workflow, independently review callback-local contracts,
  exact replay, changed input, skipped/out-of-order chunks, approval preservation, and the actual
  browser response shape before delivery.
- **Follow-up:** Add a pinned PocketBase runtime import route test once the local binary is
  available; static hook-contract checks are useful but not sufficient runtime proof.

### 2026-07-22 — Scope custom realtime hooks to their custom topic

- **Feedback:** A global guest wake `onRealtimeSubscribeRequest` hook rejected every non-guest
  topic, including the native controller's `controller_commands/*` subscription. The resulting
  error obscured the real ownership boundary and forced the controller onto polling.
- **Improvement:** Let subscriptions that do not include `karaoke_party_wake` proceed untouched;
  retain strict guest identity and single-topic validation whenever that custom topic is present.
  Validate the deployed hook with an actual subscribed controller command, not only a successful
  SSE connection.
- **Follow-up:** Keep the HTTPS fallback as recovery defense-in-depth, and ensure future custom
  realtime topic hooks explicitly delegate unrelated topics.

### 2026-07-22 — Retain authoritative delivery when realtime subscription is rejected

- **Feedback:** The retained Fire tablet could authenticate and establish a controller session, but
  PocketBase rejected its realtime subscription with HTTP 403. Treating that failure as fatal
  prevented approved commands from reaching an otherwise healthy controller.
- **Improvement:** Preserve the authenticated session only for that exact subscribe-time 403, close
  the failed realtime connection, refetch commands over HTTPS at a bounded interval, and surface
  only redacted diagnostics. Validate an actual command acknowledgement and an idempotent retry on
  retained staging; do not broaden the fallback to authentication, session, or other realtime
  failures.
- **Follow-up:** Investigate the PocketBase realtime authorization mismatch separately; HTTPS
  polling is a recoverable delivery path, not a claim that realtime is healthy.

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

### 2026-07-22 — Validate migration field access against the pinned PocketBase runtime

- **Feedback:** A catalog repair migration treated PocketBase collection fields like plain objects;
  in PocketBase 0.39.7 the field type is exposed through `field.type()`. Static checks did not catch
  the mismatch, and retained staging surfaced it during migration execution.
- **Improvement:** Exercise additive migration repairs against the pinned real PocketBase binary,
  including preserved zero values and a second idempotent application, before deployment. Treat
  collection inspection as runtime API usage rather than untyped object access.
- **Follow-up:** Keep fixture databases non-destructive and include representative retained values
  whenever schema-repair code branches on field type, relation target, or required-state metadata.
