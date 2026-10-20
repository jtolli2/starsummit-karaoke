---
name: feature
description: "Manage the scoped lifecycle of a Starsummit Karaoke feature or fix: load its context, start work, test, review, explain changes, or prepare completion. Use when implementing or evaluating a project feature through the repository's context files."
---

# Karaoke Feature Workflow

Begin with `context/current-feature.md`, `context/project-overview.md`, and the applicable rules in
`context/coding-standards.md` and `context/ai-interaction.md`. Treat `context/overview.md` as canonical
architecture when the active boundary needs it; consult targeted history and feedback entries that
bear on the behavior in `context/feature-history.md` and `context/agent-workflow-feedback.md`. Reuse
unchanged context across workflow stages and retrieve additional canonical detail only when needed.
Apply relevant feedback before acting. When a requested workflow improvement
is actually applied, append a dated entry to the feedback log; loading a feature alone never edits
history or feedback. Assume Coolify manages the initial containerized deployment at
`karaoke.app.starsummit.net`.

## Product Guardrails

- Keep YouTube API credentials and privileged integrations behind PocketBase; never place secrets in Vue client code.
- Preserve the separation of responsibilities: guests join through a coded party URL, read the sanitized queue, and submit requests through validated server logic; the tablet coordinates shared queue and playback state; SmartTube renders media.
- Never use a PocketBase superuser session in browser code. Protect `/admin` and `/tablet` with a constrained `tablet_admin` application account.
- Keep direct public queue writes disabled. Route submissions through `POST /api/karaoke/requests` and atomically validate party access, expiry, identity, duplicates, rate, and fair placement.
- Use `vite-plugin-pages` routes under `src/pages/`; treat the current empty router as pre-implementation scaffolding.
- Keep the frontend and PocketBase in separate containers within this repository, with Coolify routing same-origin `/api` and realtime traffic to PocketBase.
- Prefer the Coolify CLI for supported Coolify inspection and approved mutations. Use the read-only Coolify MCP for discovery/verification and direct API calls only when the CLI lacks the required operation.
- Treat `YOUTUBE_API_KEY_BACKUP` as server-only manual development fallback until automated
  failover is implemented as a separately scoped enhancement. Never expose key values.
- Account for real-time conflicts. Queue transitions must be atomic and must not silently lose concurrent guest submissions.
- Implement only the active feature's goals. Record unresolved product choices instead of inventing behavior.

## Implementation Checkpoint

Before any nontrivial implementation, establish a verified baseline and record the checkpoint in
the required `Implementation Decisions` and `Minimal Delta` sections of
`context/current-feature.md`:

- Record evidence-backed implementation decisions (source files, tests, runtime observations, or
  other reproducible evidence), and keep unsupported choices explicitly marked as unknown.
- Identify current consumers and boundaries for every affected contract. The inventory should cover
  Vue component props/emits and route consumers; composables, stores, and shared TypeScript types;
  PocketBase endpoints, hooks, collections, schema/rules, migrations, auth roles, and realtime
  subscriptions; and companion Android services, IPC/intents, lifecycle/process-restart behavior,
  and Keystore/persisted-state boundaries.
- Justify every new public or shared contract against an identified consumer and the request. Record
  why an existing contract cannot satisfy the goal before adding one.
- Define the smallest expected delta from the verified baseline, including explicitly out-of-scope
  behavior. Preserve existing behavior when it already satisfies the request.
- Do not add speculative abstractions, validation, compatibility layers, or tests. Add only the
  contracts and checks required by the active goals and their evidence. Prefer feature-local
  composition when a contract has a single consumer; introduce shared composition only when the
  inventory shows multiple current consumers or a required boundary.

For nontrivial product work, the load action initializes the decision and delta sections and the
start action completes this checkpoint before implementation. For small, low-risk follow-ups, keep
the evidence and delta proportionate as described in the start action. If an unresolved choice would
materially change behavior or architecture, ask the user before proceeding.

## Workflow and Validation

- For nontrivial product work, use the full sequence: `planner` -> bounded `coder` assignments ->
  `tester` -> `task_reviewer` for each assignment -> one integrated `final_reviewer`. The parent
  owns integration and names one integrated validation owner.
- For a small, low-risk follow-up, use implementation, checks attributable to the changed behavior,
  and one independent review. Involve `tester` only for an identified verification gap. Repeat a
  broad final review when the change affects contracts, authorization, shared behavior, or substantial
  integration.
- Reviewers should reuse current evidence tied to the reviewed revision or working-tree diff. They
  should request checks for specific evidence gaps instead of repeating unrelated validation. Reuse
  the assigned implementer for corrections within the same bounded assignment.
- Documentation and configuration follow-ups do not require unrelated product tests or builds.
  Product changes retain the relevant unit, production build, backend, Android, and PocketBase checks
  required by their affected behavior and active goals.

## Actions

For a scoped feature implementation request, run the lifecycle continuously by default. `load`
continues directly into `start`, then proceed through `test`, `review`, `explain`, and `complete`
without waiting for a new prompt at stage boundaries. An explicit request to perform only one stage,
including a read-only review or pause, limits the run accordingly. If the feature scope is missing,
ask for its spec or description rather than inventing one.

Stop goal work only for a legitimate blocker: an unresolved material behavior or architecture
decision; missing required access or dependency, or impossible required verification; or an action
that requires explicit approval which is absent. Ordinary implementation, test, or review failures
are work to resolve within scope, not blockers by themselves. Continue independent authorized work
while waiting on a blocked dependency. When blocked, state the exact blocker, work completed, evidence,
and what will unblock it.

Execute the requested action: `$ARGUMENTS`.

| Action | Purpose |
| --- | --- |
| `load` | Load a feature spec or inline request into the working file. |
| `start` | Mark a loaded feature in progress and implement its scoped goals. |
| `test` | Add proportionate tests and run the project validation commands. |
| `review` | Assess goals, quality, scope, and karaoke-specific risks. |
| `explain` | Summarize changed files and how the feature works. |
| `complete` | Record achieved feature goals and prepare the implementation closeout handoff. |
| `closeout` | Prepare or continue the operational closeout handoff. |

Read the matching file in `actions/` for the action's detailed procedure. If no action is supplied
and there is no scoped feature request to continue, list these options. Do not create a branch,
commit, push, merge, delete, or deploy unless the applicable action and explicit user approval allow
it.
