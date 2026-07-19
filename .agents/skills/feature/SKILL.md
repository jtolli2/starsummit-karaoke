---
name: feature
description: Manage the scoped lifecycle of a Starsummit Karaoke feature or fix: load its context, start work, test, review, explain changes, or prepare completion. Use when implementing or evaluating a project feature through the repository's context files.
---

# Karaoke Feature Workflow

Read `context/overview.md`, `context/project-overview.md`, `context/coding-standards.md`, `context/ai-interaction.md`, `context/current-feature.md`, `context/feature-history.md`, and `context/agent-workflow-feedback.md` before acting. Treat `context/overview.md` as the canonical rough draft; use the project overview as the compact reference. Apply relevant feedback before acting, and append a dated entry to the feedback log when it leads to a workflow improvement.

## Product Guardrails

- Keep YouTube API credentials and privileged integrations behind PocketBase; never place secrets in Vue client code.
- Preserve the separation of responsibilities: guests search and append songs, the tablet coordinates shared queue and playback state, and SmartTube renders media.
- Account for real-time conflicts. Queue transitions must be atomic and must not silently lose concurrent guest submissions.
- Implement only the active feature's goals. Record unresolved product choices instead of inventing behavior.

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
