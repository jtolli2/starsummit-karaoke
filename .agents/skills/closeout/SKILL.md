---
name: closeout
description: "Prepare or continue a Starsummit Karaoke implementation handoff while tracking pending user-goal and operational work."
---

# Starsummit Karaoke Closeout

Prepare a concise, reviewable handoff when implementation is ready, even if live validation or
other user goals remain. Keep implementation readiness separate from full goal completion. Verify
the actual checkout, branch, HEAD, working-tree diff, and the approval evidence relevant to any next
action. Approval prose retained in old feature context is not current authorization by itself.

Include:

- Repository, branch, current HEAD, and PR when one exists.
- Delivered scope and decisions, with links to the relevant local files.
- Validation commands/selectors and results, evidence revision, limitations, and findings.
- Pending goals or live actions, the exact next target and effect, and any required approval boundary.
- Local files or data to preserve, including explicit resource-preservation constraints.
- For operational closeout, provide a compact evidence bundle: exact implementation SHA; deployment
  health and a mechanical comparison of the actual live mounted volume with its expected identity;
  fingerprints for dirty local files that must be preserved; and, when applicable, APK hash and
  verified device identity. Keep sanitized authoritative convergence evidence separate from physical
  TV proof. Do not infer a live mount from generated metadata or repair state automatically.
- State the approval source, exact action, target, expected effect, and exclusions. Include pending
  proof and the next handoff. Use CLI-first inspection; use API SHA pinning only for a verified CLI
  gap and preserve the applicable approval boundary. Preflight tool availability, authentication, and
  target identity; assign one owner for all UI work, capture milestones, use bounded polling, and
  stop/escalate when identity or state is uncertain.

Use a fresh chat only when the user explicitly authorized creating one. If continuing in an existing
closeout chat, continue there without recursively creating another chat. For an authorized new chat,
use `list_projects` and `create_thread` as required and include this skill's location and the complete
self-contained handoff. After a successful Codex app `create_thread`, emit
`::created-thread{threadId="..."}` on its own line in the final response, using the returned
`threadId`; for queued setup, use the returned `clientThreadId` instead. Follow the Codex desktop
created-thread directive format. This directive applies only to an explicitly authorized new chat.

Respect repository approval boundaries for commits, pushes, deployments, tablet actions, and other
remote or destructive changes. Verify authorization against the exact target and expected effect;
avoid asking again when current explicit approval covers that exact action and target. Keep the
original implementation, operational closeout, and any new product fix as distinct scopes. Use the
Coolify CLI with allowlisted output, reuse an authenticated constrained tablet browser session when
available, and never expose credentials, cookies, tokens, or secret-bearing output. Preserve the
PocketBase volume and Lounge material. When those targets are in scope, identify exact product SHAs
and APKs.

For corrections within the same bounded assignment, reuse its implementer. Match checks and reviews
to the affected scope, use current evidence tied to the reviewed revision or working-tree diff, and
request targeted checks for identified gaps. A small low-risk follow-up uses one independent review;
contract, authorization, shared-behavior, or substantial integration changes need broad final review.
Leave pending operational work clearly pending. Manual end-to-end checks requiring the user,
such as direct TV observation, are non-blocking follow-up notes unless the user explicitly makes
them a release/completion gate. State exactly what remains unverified without claiming it passed.
Once other active goals are met, mark the feature complete and retain these notes. Lead the final
response with explicit completion status and separate manual follow-ups from agent work still owed.

## Local closeout evidence tools

For applicable operational evidence, read [the tool guide](../../../tools/closeout/README.md) and
invoke the collector from the repository root with `python3 -B -m tools.closeout`. Prefer these
collectors to bespoke scripts when their evidence matches the task:

- `release` distinguishes configured SHA from the latest finished deployment and checks the supplied
  live Docker context/container mount. Generated storage metadata does not establish the mounted
  volume; the caller-supplied health endpoint is not independently associated with the app.
- `device` requires the exact device identity and expected local APK path/hash. `tablet-status` uses
  only the constrained endpoint and an approved ephemeral token on stdin; do not export browser
  credentials or add an authentication path. An unavailable result is valid when access is absent.
- `handoff` can consume `capture-run`, `manifest`, and applicable release/device/controller records.
  Keep implementation SHA separate from documentation HEAD and describe the uncommitted diff.
  Approval context in a generated handoff never grants authorization.

Write evidence artifacts outside the checkout with exclusive creation. If redirecting stdout, choose
a new path yourself so shell redirection cannot overwrite an existing artifact. Records are
timestamped snapshots, not indefinitely current live state. Keep required domains and pending proof
separate from the task's actual scope; documentation or tooling work does not imply irrelevant device
or UI checks.
