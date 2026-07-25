# Catalog Review Search by YouTube Title

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Let a signed-in `tablet_admin` search catalog-review songs by stored YouTube `video_title` on
  `/admin`, without changing public catalog access or exposing privileged credentials.
- Retain exact 11-character YouTube-ID lookup and compose title search with current review-state,
  source, and deterministic pagination filters through safe PocketBase parameterization.
- Normalize bounded literal title queries safely, preserve canonical identity versus uploader/channel
  provenance, and show a clear empty state.
- Add focused backend, runtime, and Vue coverage, then validate staging deployment and live
  authenticated admin search without mutating catalog review or identity records.

## Constraints and Notes

- Preserve the retained external PocketBase volume and all existing records. Do not approve,
  reject, replace, correct, or otherwise mutate catalog identity/review state during validation;
  do not invoke YouTube, mutate matcher jobs, queues, parties, controller/tablet enrollment,
  Lounge, Fire, Wi-Fi, DNS, or raw database records.
- Search input is literal, trimmed, case-insensitive, capped, and additive to exact-ID lookup.

## Implementation Notes

- 2026-07-25: Synchronized `main` at `394ab83`; prerequisite queue-reorder product commit
  `e20c6b6` and its evidence commit `394ab83` are both present. Standing approval covers scoped
  local edits/tests, signed commit/push to `main`, retained staging deployment, and constrained
  browser validation.
- 2026-07-25: Added a `tablet_admin`-only `videoTitle` query to the catalog-review route. It
  normalizes NFKC text, trims and caps input at 160 characters, composes with review,
  classification, and exact YouTube-ID filters, and retains `+title,+youtube_id,+id` pagination.
  User text is always bound as a PocketBase parameter. `%`, `_`, and backslash use a bounded
  server-side literal post-filter because PocketBase 0.39.7 LIKE escaping is not portable across
  retained SQLite builds; no catalog is loaded into Vue.
- 2026-07-25: `/admin` now supplies a separate explicit “Search YouTube title” control. It keeps
  the exact 11-character ID lookup additive, resets the current page and selection on submit, and
  makes the empty state title-aware. Canonical title/artist and YouTube title/uploader remain
  separately labeled.
- 2026-07-25: Local evidence passed: 63 Vue tests; focused catalog-hook assertions; a temporary
  pinned PocketBase 0.39.7 runtime integration covering tablet authorization, case-insensitive
  partial matches, review/classification/exact-ID composition, deterministic two-page pagination,
  literal `%`/`_`, and empty results; production build; all hook syntax; diff/secret review; and
  independent review.
- 2026-07-25: Signed product commit `8cd4f1ecbe7e0f41c0f4415c2a48022d42ec237e` was pushed to
  `main` and deployed unchanged to retained Compose staging app `wyxit9qifbwgskjrwibxb330` as
  Coolify deployment `pndvuz6s4mz7iojdnck1aall`. Coolify marked it finished at that exact SHA;
  public `/api/health` settled at 200 after the rolling handoff. The existing authenticated `/admin`
  session verified lower-case partial `when we all fall asleep`, a title-aware no-match state, and
  `karaoke version` pagination from page 1 of 36 to page 2 of 36 while retaining Needs review and
  displayed YouTube source provenance. No review, identity, catalog, queue, party, controller,
  tablet enrollment, Lounge, Fire, Wi-Fi, matcher, or YouTube API mutation was performed.
