# Popular-Song Source Selection and Initial Catalog Population

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Select and document a reproducible, legally and operationally reasonable real popular-song
  source from primary evidence, including rejected alternatives and a bounded US/English-first
  corpus policy that stops for weak coverage rather than padding to 5,000 songs.
- Integrate the source with the existing resumable, idempotent, quota-aware catalog pipeline while
  preserving canonical source artist/title, stable identity/rank/list, retrieval time, source
  digest, checkpoint evidence, genre/era metadata when available, and deterministic collaboration
  normalization without losing display metadata.
- Enforce artist integrity across import, replay, deduplication, review, replacement, and fallback:
  YouTube channel/uploader data is provenance only and can never populate or overwrite canonical
  song artist/title; missing or uncertain source identity remains ineligible and reviewable.
- Keep karaoke candidates heavily preferred, retain controlled lyric/audio fallbacks only when no
  suitable karaoke result exists, and reject live, misleading, unrelated, and weak candidates.
- Add catalog coverage/quality reporting and improve constrained tablet review so source identity,
  canonical metadata, uploader provenance, classification evidence, corrections, and rejection
  reasons are distinct and auditable without browser superuser credentials.
- Preserve sanitized deterministic approved/eligible-only guest search based on canonical identity,
  add proportionate unit, hook-contract, pinned-runtime, and UI validation, obtain independent
  review, and deliver a carefully bounded retained-staging tranche using available quota.

## Constraints and Notes

- Standing approval covers feature-scoped research, local edits, commits/pushes to existing `main`,
  retained-staging deployment/configuration, quota use, repair of incorrectly attributed staging
  records, and up to 5,000 staging records. It excludes deletion/cleanup, retained-volume changes,
  production DNS/hostname changes, unrelated Coolify changes, paid commitments, tablet/controller
  mutation, destructive resets, and the deferred Wi-Fi interruption test.
- Preserve all existing party, queue, controller, enrollment, validation, and persistent-volume
  state. Do not delete the two suspect live candidates; correct them only from reliable source or
  explicit operator identity and retain an audit trail, otherwise mark them ineligible for
  correction.
- Selected ordered MusicBrainz recording series: the pinned Rolling Stone 2021 list plus available
  Billboard Year-End Hot 100 subseries. MusicBrainz core data is CC0; the API is current and
  reproducible with an identifying User-Agent and one-request-per-second limit. A live ListenBrainz
  sample was rejected as the primary corpus because it failed the artist/diversity quality stop.
- The planner round-robins Billboard years and the Rolling Stone list by explicit series rank,
  preserves MusicBrainz artist-credit join phrases, enriches earliest official release year and
  genres when available, caps artist concentration, rejects ambiguous/missing identities, and
  emits deterministic per-song checkpoint requests with modeled YouTube cost.
- Legacy catalog rows are forward-only quarantined as `needs_review` and ineligible until canonical
  source or audited operator identity is established. Re-import of an existing YouTube ID appends a
  non-destructive identity proposal; it never promotes uploader metadata or overwrites curation.
- Validation: 36 importer/hook contracts, three pinned PocketBase 0.39.7 preservation/idempotency
  integrations, 15 Vue tests, and the production build pass. Whole-repository Oxlint remains red
  on pre-existing hook/migration/test lint debt; no auto-fix was applied. Independent review found
  the initial checkpoint, legacy eligibility, provenance, artist-credit, and release-year defects;
  all were corrected and the final verdict is APPROVE with no blockers.
- YouTube quota must be modeled before each live tranche. Exact replay and unchanged canonical
  inputs must consume no repeat search quota; stop safely when quota or review quality is limiting.
