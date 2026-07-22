# Catalog Import Replay Compatibility and Audited Population

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Reproduce the retained PocketBase 0.39.7 ready-claim replay failure with realistic schema and
  JSON value shapes, then document the exact native wrapper, scalar, string, array, object, and
  null representations that cross the hook boundary.
- Introduce one strict canonical JSON normalization and serialization boundary shared by hook and
  importer behavior. Preserve valid types exactly and fail closed on malformed or ambiguous data.
- Make the claim lifecycle transactional and monotonic across reservation, discovery/spend, ready,
  commit/replay, failure/retry, restart, expiration/reclaim, and ambiguous response reconciliation,
  while preserving source/chunk identity, ordered payload, digest, quota, candidates, and history.
- Prove exact-replay idempotency, zero replay quota, restart recovery, authoritative reconciliation,
  conflict and reorder rejection, one durable concurrent outcome, and exactly-once reservation
  release without erasing actual spend.
- Add forward-only retained-data repair/quarantine and pinned PocketBase 0.39.7 integration coverage
  for realistic legacy shapes, replay, restart, concurrency, and value-shape regressions.
- Add only the operator diagnostics necessary to expose safe claim/source/chunk/quota/replay/failure
  state, preserving credential and guest/tablet authorization boundaries.
- Deploy an exact runtime SHA to the named retained PocketBase and frontend staging apps as needed,
  preserve volume `ggkfvh2tpdprcocn1sycu8zf`, and prove an already-paid canary through ready,
  commit, exact replay, restart, and authoritative reconciliation with zero new search quota.
- Only after the canary succeeds, execute and audit a MusicBrainz tranche capped at 25 new canonical
  songs, with quota modeled first and hard stops for identity, attribution, classification, replay,
  or accounting uncertainty. Keep every imported candidate unreviewed and ineligible.
- Preserve sanitized deterministic approved/eligible-only guest search, MusicBrainz identifying
  User-Agent and at-most-one-request-per-second behavior, and all party, queue, controller, tablet,
  enrollment, validation, alternative, review, and catalog records.

## Constraints and Notes

- Standing approval covers feature-scoped local changes, tests, signed commits and pushes to the
  existing `jtolli2/starsummit-karaoke` `main`, existing backend-only MusicBrainz/YouTube use,
  retained-staging deployment/config, transactional claim/audit repair, and audited tranches capped
  at 25 new canonical songs each. Report all mutations without exposing credentials.
- No deletion or cleanup is authorized. Do not replace/remove the persistent volume, mutate
  production hostname/DNS, change unrelated Coolify resources, incur paid commitments, mutate the
  tablet/controller, perform destructive resets, or run the deferred Wi-Fi interruption test.
- Current local/main HEAD is `0dc9b969fb93f33c8ad7dad26cee606aff34cb9a`; retained runtime product
  SHA is `50acaa8c92a34d6e94e037351655e07b04d324f0` on PocketBase app
  `xbqbuq8gvckl7r2hgi6yabws` and frontend app `f3b92sq9dy8y5ernb1nw9cfs` at
  `https://karaoke-test.app.starsummit.net`, using private alias `pocketbase-staging:8090`.
- Selected source is the ordered MusicBrainz Rolling Stone 2021 plus available Billboard Year-End
  Hot 100 recording series under `docs/catalog-source-policy.md`. The five-song manifest fingerprint
  is `b2f47574d7727bb143be393691928bbb20a5a54dc1f3824748785ad205ff3993`.
- Prior discovery spent 101 YouTube units and retained nine candidates; replay spent zero. Claim
  `dy36tlhzi17ew1p` was repaired from 303 reserved units to 0 while retaining payload/spend. Use this
  already-paid data for the staging canary before any new search.
- Staging begins with 18 songs and an 18-item review backlog. Rick Astley / Never Gonna Give You Up
  remains corrected but needs-review/ineligible; `9iQH7g_zKl8` remains missing/ineligible; Simon &
  Garfunkel / Bridge Over Troubled Water remains MusicBrainz-ranked with uploader Atomic Karaoke,
  92% karaoke confidence, unreviewed/ineligible.
- Canonical artist/title may come only from MusicBrainz/source or constrained operator input.
  YouTube uploader/channel is separate provenance and must never populate canonical artist.
- Stop after the first tranche if material attribution/classification errors exceed the documented
  threshold, replay evidence is incomplete, or quota accounting is uncertain. Do not bulk approve
  or pad population toward 5,000 songs.
