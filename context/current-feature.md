# Simple Tablet Queue Reordering and Visibility Fixes

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Let a signed-in `tablet_admin` move queued songs up or down on `/tablet`, while the playing song
  remains fixed and non-movable.
- Add one constrained atomic server reorder endpoint that rejects stale/conflicting queue input and
  preserves membership, statuses, existing playback, controller, and guest-request contracts.
- Make the manual queued order authoritative for the current queued set; safely preserve it when
  new guest requests are added through the existing placement rules.
- Improve only the visibly weak guest request/search/confirmation/error colors and related tablet
  queue controls, without a broader accessibility or design-system rewrite.
- Add focused stale/concurrency backend and Vue move/error/immovability/visibility tests; validate
  the pinned PocketBase runtime where applicable, full Vue suite, production build, hook syntax,
  diff/secret checks, and review.

## Constraints and Notes

- Preserve the retained external PocketBase volume and all party, queue, catalog, controller,
  enrollment, matcher, and playback state. No live queue mutation, deployment, commit, push,
  DNS/cutover, tablet/Wi-Fi/Lounge action, catalog work, raw database write, or cleanup is in scope.
- Use clear touch move-up/move-down controls only unless a drag interaction proves genuinely small
  and dependable; do not add reorder audit metadata.

## Implementation Notes

- 2026-07-25: Started from synchronized `main` at `1b10127`, after the fallback repair product
  commit `05dd13c` and its validation documentation were present. Local implementation and
  validation are approved; all delivery or live-state mutation remains separately approval-gated.
- 2026-07-25: Added a constrained `tablet_admin` reorder route using an authoritative active-queue
  revision and digest. It atomically swaps only adjacent queued rows, rejects stale/conflicting
  snapshots with `stale_reorder`, and leaves the playing row, membership, and statuses unchanged.
  The persisted sequence is now the next-song and tablet-display order; later guest requests retain
  their existing safe append sequence.
- 2026-07-25: `/tablet` now has touch-sized Up/Down controls with first/last boundaries and no
  controls for the playing row. The client refetches authoritative status after success or failure.
  Targeted dark guest message/search and tablet-control colors improve legibility without a visual
  redesign. Final local evidence: 61 Vue tests, 16 backend protocol tests, production build, hook
  syntax, diff, secret-pattern review, and independent review all passed. The three integration
  scenarios are present but skipped because `POCKETBASE_BIN` is not configured locally.
