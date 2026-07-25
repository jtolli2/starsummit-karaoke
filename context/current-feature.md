# Automated MusicBrainz Canonical Identity Matching

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Deterministically parse newly imported or revealed YouTube playlist song titles while preserving
  channel/uploader data strictly as provenance, never canonical artist identity.
- Query and compare MusicBrainz recording candidates with an identifying User-Agent, no more than
  one request per second, durable replayable cache, normalized artist/title comparison, aliases,
  featured artists, and recording/release evidence.
- Apply only unambiguous, high-confidence canonical corrections through the existing constrained,
  audited application workflow. Corrected songs must remain `needs_review` and ineligible.
- Make the runner resumable, restart-safe, bounded, idempotent, dry-run capable, and report
  confidence, evidence, match reason, runner-up separation, and reason-coded deferrals.
- Fail closed for malformed data, covers, medleys, live/remix/version ambiguity, competing
  recordings, canonical conflicts, weak/near-tied candidates, and no-result cases; never call
  YouTube for matching work or alter unrelated/pre-existing rows or retained state.
- Evaluate durable, audited MusicBrainz recording/release provenance without making identity depend
  on a single release; validate against the pinned PocketBase 0.39.7 runtime and independently
  review the completed local implementation.

## Constraints and Notes

- Run only against eligible newly imported/revealed playlist records through authenticated,
  constrained server routes; no browser secrets, direct database/superuser writes, auto-approval,
  or eligibility expansion.
- Local implementation and non-destructive validation are authorized. A separate explicit approval
  is required before commits, pushes, remote PocketBase/Coolify mutations, deployments, deletion,
  or any MusicBrainz live processing that persists remote records.
- Preserve all unresolved and pre-existing rows, retained volumes, controller/tablet state, queue
  state, and imported playlist provenance. Do not restart the stopped curator or create a watcher.

## Implementation Notes

- 2026-07-24: Loaded from the delegated feature request after the preceding Admin-Confirmed Public
  Playlist Import feature completed. Exact baseline: `origin/main` / local HEAD
  `239a1f3fdcb11f2202ee2959e9f213c705238a67`.
- Began local-only discovery and implementation. No curator/watch was restarted and no remote
  MusicBrainz, PocketBase, Coolify, commit, push, or deployment mutation has been performed.
- 2026-07-24: Added a conservative deterministic MusicBrainz matcher, snapshot-bound bounded
  tablet-admin runner, durable replay cache/rate lease/job checkpoints, and shared audited
  correction path. It never uses uploader/channel data as identity, keeps corrections
  `needs_review`/ineligible, and dry runs are cache-only. Focused matcher/job tests pass 9/9;
  hook syntax and diff checks pass. Pinned PocketBase 0.39.7 route validation is blocked locally
  because no `POCKETBASE_BIN` is installed. An existing checkpoint-health regex test is unrelated
  to this feature and continues to fail against the unchanged baseline route.
