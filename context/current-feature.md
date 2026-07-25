# Completed Matcher One-Time Catalog Approval

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

 In Progress

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
