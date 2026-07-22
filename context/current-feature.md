# Catalog Import Replay Compatibility and Audited Population

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

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

## Completion Notes

- PocketBase 0.39.7 exposes retained JSON through several shapes: `getString` provides the
  authoritative JSON document for JSONRaw/native wrappers, while `get` may expose scalars, native
  arrays/objects, serialized strings, or byte-like arrays. The canonical boundary parses only the
  authoritative string representation, preserves raw numeric arrays, validates native values,
  rejects undefined/non-finite/cyclic/ambiguous values, stores validated native JSON, and uses
  deterministic serialization only for identity and digest calculation.
- Claims now preserve source/chunk identity, ordered candidates, payload digest, actual/reserved
  quota, bounded audit history, and lifetime replay count. Durable ready claims resume against an
  existing chunk, complete claims replay exactly, conflicting identity/order/digest fails closed,
  and inconsistent nonzero ready reservations are rejected without changing either ledger.
- Forward-only migrations quarantined unknown legacy shapes and repaired only the exact retained
  canary `dy36tlhzi17ew1p` after validating its full claim key, source fingerprint, spend, payload
  count, and nine-item order. No record or volume content was deleted.
- Product commits `5ef72f3807f8452c7f5911cffb35e41557cf30d9`,
  `76d9602b42e678d36512278cc3dfd8265f9c8ba4`,
  `98d6ea957128b82d47dab1ae5aaa3a1e7ba91227`,
  `29e4e05d47defad63e2919742ad74fbdd49c5698`, and
  `204d0f6812b32fbac029e7b82007593eebdac4c4` were signed and pushed to `main`.
- Final retained staging runs `204d0f6812b32fbac029e7b82007593eebdac4c4`: PocketBase deployment
  `i14gl0508juv9pjvy05x1hdz` and frontend deployment `xzok7k4as8d5lf3bi3x86wrx` are healthy.
  Volume `ggkfvh2tpdprcocn1sycu8zf` and private alias `pocketbase-staging:8090` were preserved.
- The already-paid canary fingerprint matched `62161f11f34dc9d2688413e0b14c41c42902165eb1fac98ae658635089529d9b`.
  Live ready-to-resumed-commit returned `resumed: true`, exact replay returned `replay: true`, and
  post-container-restart reconciliation returned `replay: true`. Claim spend stayed 101, reserved
  stayed 0, replay count reached 4, and no song/alternative duplication occurred.
- The representative MusicBrainz tranche modeled 404 units for four canonical requests but stopped
  after the first request. `Shadow Dancing` discovery spent 101 units, committed no song, and
  failed closed because an optional YouTube classification value was `undefined`; the claim
  `rswrd2ktm5cf6yq` is failed with reserved 0/spent 101. The daily ledger moved from 303 to 404,
  reserved 0, exactly matching the single search+details call. No later request was attempted.
  Commit `204d0f6` makes unavailable external classification explicitly `null` while keeping final
  classification server-derived. The tranche was not retried or expanded because the documented
  material-error stop applies.
- Validation passed 65 backend tests including every pinned PocketBase 0.39.7 catalog, party,
  auth, controller, and realtime integration; 15 Vue tests; production build; hook syntax;
  retained-volume Compose config; live health; canary replay/restart; and independent review with
  final APPROVE verdicts. Live review then exposed the Bridge alternatives field as a recursively
  serialized numeric wrapper (7,654 byte elements, not records). It was reconstructed from the
  authoritative canary payload as eight distinct alternatives and received an explicit
  `alternatives_json_wrapper_repair` history event. Final catalog state is 18 songs, eight
  alternatives, and 18 review items, all unreviewed or needs-review/ineligible as previously
  recorded.
