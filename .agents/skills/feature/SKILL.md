---
name: feature
description: "Manage the scoped lifecycle of a Starsummit Karaoke feature or fix: load its context, start work, test, review, explain changes, or prepare completion. Use when implementing or evaluating a project feature through the repository's context files."
---

# Karaoke Feature Workflow

Read `context/overview.md`, `context/project-overview.md`, `context/coding-standards.md`, `context/ai-interaction.md`, `context/current-feature.md`, `context/feature-history.md`, and `context/agent-workflow-feedback.md` before acting. Treat `context/overview.md` as the canonical rough draft; use the project overview as the compact reference. Apply relevant feedback before acting. When a requested workflow improvement is actually applied, append a dated entry to the feedback log; loading a feature alone never edits history or feedback. Assume Coolify manages the initial containerized deployment at `karaoke.app.starsummit.net`.

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

The load action initializes the decision and delta sections; the start action completes this
checkpoint before production code. If an unresolved choice would materially change behavior or
architecture, ask the user before proceeding.

## Actions

Execute the requested action: `$ARGUMENTS`.

| Action | Purpose |
| --- | --- |
| `load` | Load a feature spec or inline request into the working file. |
| `start` | Mark a loaded feature in progress and implement its scoped goals. |
| `test` | Add proportionate tests and run the project validation commands. |
| `review` | Assess goals, quality, scope, and karaoke-specific risks. |
| `explain` | Summarize changed files and how the feature works. |
| `complete` | Prepare a tested feature for approved delivery and archive its context. |

Read the matching file in `actions/` for the action's detailed procedure. If no action is supplied, list these options. Do not create a branch, commit, push, merge, delete, or deploy unless the applicable action and explicit user approval allow it.
