# Fallback Queue Request Persistence Repair

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Repair fallback queue requests so newly persisted YouTube fallback candidates satisfy every
  currently required catalog default in real PocketBase 0.39.7, including `mb_match_status`.
- Add a pinned-runtime regression for party-scoped claim/grant fallback request persistence, queue
  creation, idempotent replay, and relevant rejection behavior.
- Normalize unexpected persistence/schema failures into safe guest-facing fallback errors without
  weakening known duplicate, rate, expiry, or candidate-specific responses.
- Validate backend contracts, pinned runtime integration, Vue tests, build, syntax, diff/secret
  checks, independent review, signed delivery to `main`, retained Compose staging deployment, and
  constrained cached live verification without consuming new YouTube quota.

## Constraints and Notes

- Preserve the retained external PocketBase volume and all unrelated party, queue, controller,
  catalog, matcher, enrollment, and review records. Do not manufacture canonical identity or
  approve/reject fallback catalog records.
- Standing approval covers scoped local edits, tests, signed commit/push to `main`, exact retained
  Coolify deployment, constrained guest queue validation, and browser actions. It excludes deletion,
  cleanup, volume replacement, production DNS/cutover, Wi-Fi/tablet/Lounge changes, matcher work,
  raw database writes, and a new YouTube lookup when cached replay can validate.

## Implementation Notes

- 2026-07-25: Started from current `main` at `f521a17706b1234c7344c4bd738809ef711d9276`.
  Confirmed staging symptom and local real-runtime reproduction identify omitted required
  `mb_match_status` on the new fallback-song record as the immediate cause.
- 2026-07-25: New fallback records now explicitly persist `mb_match_status: not_attempted`.
  The replay lookup remains party/requester scoped and returns the existing queue row with HTTP 200;
  expired grants use PocketBase's canonical filter date format. Known rejections remain specific,
  while unexpected persistence errors return the safe retryable
  `fallback_persistence_unavailable` contract without database validation text.
- 2026-07-25: Focused fallback static contract and pinned PocketBase 0.39.7 integration passed.
  The runtime regression seeds an isolated party guest, ready claim, and party-scoped grant, then
  verifies persistence, `mb_match_status`, queue linkage, exact idempotent replay, and a
  cross-party candidate rejection. Full Vue tests (58) and production build also passed.
