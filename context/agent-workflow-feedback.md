# Agent Workflow Feedback

> Append-only log of feedback and verified improvements to agent execution. Record the date, observed issue or suggestion, the resulting workflow change, and any follow-up needed; do not alter earlier entries.

## Entries

### 2026-07-19 — Clarify implementation security and routing boundaries

- **Feedback:** The guidance left runtime ownership, browser admin credentials, guest queue writes, party access, and router generation ambiguous or contradictory.
- **Improvement:** Documented separate frontend/PocketBase containers, same-origin Coolify `/api` routing, coded party URLs, a constrained `tablet_admin` application account, a validated queue-request endpoint, and `vite-plugin-pages` file routing.
- **Follow-up:** Keep the SmartTube control spike open until it is investigated separately.
