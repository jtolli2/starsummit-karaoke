# Agent Workflow Feedback

> Append-only log of feedback and verified improvements to agent execution. Record the date, observed issue or suggestion, the resulting workflow change, and any follow-up needed; do not alter earlier entries.

## Entries

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
