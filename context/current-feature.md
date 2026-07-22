# Popular-Song Source Selection and Initial Catalog Population

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

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
- Validation: 39 importer/hook contracts, the full 58-test backend suite, pinned PocketBase 0.39.7
  catalog/party/realtime integrations, 15 Vue tests, and the production build pass.
  Whole-repository Oxlint remains red
  on pre-existing hook/migration/test lint debt; no auto-fix was applied. Independent review found
  the initial checkpoint, legacy eligibility, provenance, artist-credit, and release-year defects;
  all were corrected and the final verdict is APPROVE with no blockers.
- YouTube quota must be modeled before each live tranche. Exact replay and unchanged canonical
  inputs must consume no repeat search quota; stop safely when quota or review quality is limiting.
- Retained staging ultimately deployed product SHA `50acaa8c92a34d6e94e037351655e07b04d324f0`
  to backend (`vvnypl84x804g5uz7gcy2vxe`) and frontend (`larll0lgs0l1sk941vc942go`). Exact-SHA
  logs and health checks passed; the retained volume was preserved. Test-only follow-up
  `7ab995e` was pushed after deployment and does not change the runtime image.
- The migration preserved and quarantined all 16 retained catalog rows. Suspect video
  `nMDXPAM8RwE` was audit-corrected through constrained tablet access to canonical `Rick Astley` /
  `Never Gonna Give You Up`; it remains `needs_review` and ineligible. `9iQH7g_zKl8` remains
  missing/uncertain and ineligible because assigning the same identity would collide with the
  corrected primary; it is retained for operator deduplication/replacement and was not deleted.
- A live five-item MusicBrainz tranche produced manifest
  `b2f47574d7727bb143be393691928bbb20a5a54dc1f3824748785ad205ff3993` across 1970, 1978,
  2002, 2008, and 2009 lists, with 505 expected and 1,515 conservatively reserved YouTube units.
  A transient MusicBrainz 503 caused zero YouTube spend and led to reviewed Retry-After-compliant
  retry handling. Constrained live discovery then spent 101 units and retained nine candidates,
  but a retained PocketBase JSON-scalar replay incompatibility prevented automatic chunk commit.
  Broad expansion stopped rather than repeat quota. One visibly audited karaoke candidate from
  that paid result was committed through the idempotent fixture path: canonical `Simon &
  Garfunkel` / `Bridge Over Troubled Water`, MusicBrainz list rank 1, uploader `Atomic Karaoke`,
  92% karaoke confidence, unreviewed and ineligible. The other eight candidates remain retained.
- Final staging report: 18 songs; sources fixture 1, MusicBrainz 1, YouTube 2, unknown 14;
  classifications karaoke 4 and unknown 14; review backlog 18; identity verified-source 1,
  operator-corrected 1, missing 16; alternatives 8; no unavailable items. Live checks passed
  same-origin `/api/health` (200), canonical/uploader separation in the tablet UI, retained
  unauthenticated denial, and healthy exact-SHA deployments. The retained
  volume `ggkfvh2tpdprcocn1sycu8zf`, party/queue/controller/enrollment state, production routing,
  and Wi-Fi state were unchanged.
