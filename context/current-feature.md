# Completed Matcher One-Time Catalog Approval

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

 Complete

## Goals

- Add a constrained `tablet_admin` endpoint that previews and commits approvals only for songs
  authoritatively matched by completed legacy matcher job `sqwd85vrfrwrzym`.
- Bind the operation to immutable job input and row digests, reapply the shared catalog approval
  policy, preserve rejected/deferred/conflicting/unrelated rows, and audit every approved song.
- Make the one-time operation resumable and idempotent in bounded chunks using the existing durable
  catalog approval operation collection.
- Expose a guarded `/admin` control for preview and explicit confirmation, with useful totals and
  exclusion reasons.
- Validate contracts, Vue behavior, build output, retained staging deployment, and final live totals
  without replacing the PocketBase volume or altering the completed matcher evidence.

## Constraints and Notes

- Preserve the constrained `tablet_admin` boundary, completed matcher job, `mb-majority-v2` policy,
  matcher cache/hooks, retained volume, and unrelated catalog/party/queue/controller/tablet state.
- Never approve rows that are deferred, rejected, unavailable, non-karaoke, low-confidence,
  conflicting, malformed, or no longer bound to the completed job evidence.
- Standing approval covers the scoped local implementation, signed commit and push to `main`,
  retained staging deployment, and the exact constrained batch mutation. It excludes deletion,
  volume replacement, DNS/cutover, Wi-Fi testing, superuser browser writes, and unrelated curation.

## Implementation Notes

- 2026-07-25: Started from clean synchronized `main` at
  `772df917583a2d6edb07c57e54c256ba28db6288`. User confirmed matcher job
  `sqwd85vrfrwrzym` is complete and approved the exact one-time commit, deployment, and mutation.
- 2026-07-25: Added a constrained, completed-job-bound preview/commit route with immutable row
  binding checks, shared approval-policy revalidation, durable 20-row transactions, idempotent
  operation binding, per-song audit, and an explicit `/admin` confirmation control. Focused backend
  contracts passed 8/8, Vue passed 58/58, and the production type-check/build and hook syntax passed.
- 2026-07-25: Signed product commit `72de9202df44c8390117f8c83ace58d4f26d963b`
  was pushed and deployed by Coolify as `ye7n8b6m466upc2zqyfcn6uf`; exact imported SHA and terminal
  deployment status were verified. Frontend, `/admin`, same-origin API, and controller health
  returned 200 after the rolling handoff; the external PocketBase volume was preserved.
- 2026-07-25: Constrained live preview found 1,408 job-bound matches: 1,335 approvable, 73 already
  approved, and zero policy exclusions. The approved resumable operation newly approved all 1,335
  and treated the 73 as idempotent exclusions. A fresh authoritative preview found 1,408 already
  approved, zero approvable, and zero excluded; the review backlog fell from 2,116 to 781.
