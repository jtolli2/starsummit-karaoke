# Party Lifecycle and Fair-Rotation Queue Request API

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Add versioned PocketBase 0.39.7 schema for expiring parties, party-scoped temporary guest
  identities, karaoke-eligible song records, and party queue records. Keep public direct writes to
  queue and library collections disabled.
- Generate cryptographically random, human-typeable party codes server-side, persist only a
  suitable server representation, rate-limit party lookup/join, and enforce a 12-hour expiry for
  parties and guest access.
- Provide a guest join endpoint that returns a party-scoped temporary credential without creating
  permanent guest accounts. Let guests read only a sanitized active queue and submit through
  `POST /api/karaoke/requests`.
- Atomically validate access and expiry, temporary identity, known eligible song/YouTube metadata,
  active duplicate requests, request rate, and fair placement. Return stable, clear rejection
  explanations; permit a completed song to be requested again.
- Apply deterministic requester round-robin: preserve FIFO within each requester; choose the
  requester whose previous served turn is oldest; every requester with a pending song gets one
  turn before any requester receives a second; break equal timestamps by first pending queue
  sequence, then requester ID. A sole requester proceeds FIFO.
- Restrict queue transitions (`queued` -> `playing` -> `completed` or `failed`) to
  `tablet_admin`, make transition retries idempotent, preserve concurrent submissions, and create
  a minimal approved native-controller command handoff only when a queued song starts.
- Add real PocketBase integration coverage for authorization, expiry, rate limiting, duplicate
  races, deterministic rotation, concurrent submissions, idempotent transitions, and controller
  command handoff. Keep Vue changes limited to typed contracts if needed.
- Record the approved import-quality decision: the future initial 5,000-song import must include
  only karaoke backing-track YouTube videos, excluding original music videos, ordinary lyric
  videos, live performances, and non-karaoke covers. Do not implement import/search here; retain
  provenance and eligibility fields needed to enforce it later.

## Notes

- Baseline is clean public `main` at signed commit
  `3f103ba8df45cb473c26ff585a3d71d373bb5464`.
- The proven native-controller protocol remains authoritative for command persistence and device
  delivery. Guest/browser clients receive neither controller credentials nor playback privileges.
- Feature-relevant commit, push, deployment, and live-infrastructure actions are approved for this
  thread. No APK installation or Wi-Fi interruption is in scope.
- The queue schema keeps all direct collection writes and raw collection reads locked. Guest queue
  reads use the sanitized endpoint and a hashed, party-scoped temporary credential only.
- Rotation uses each requester's oldest queued item; candidates sort by `last_served_at` (never
  served first), then that item’s party sequence, then requester ID. Starting an item records its
  requester’s served timestamp and, when the party has an enrolled controller, atomically creates
  the proven `open_video` controller command with a queue-item idempotency key.
- Local verification currently passes: both pure PocketBase contract suites, real PocketBase 0.39.7
  controller and party-lifecycle integration harnesses using temporary data, `bun test:unit --run`,
  and `bun run build`. The party integration presently covers authorization and expiry smoke paths;
  the remaining requested race/rate/transition/handoff matrix still needs expansion before this
  feature can be marked complete.
- Independent review found blocking follow-ups: enforce fair selection inside the transition
  transaction (the preview endpoint is advisory today); make duplicate/sequence allocation robust
  under concurrent inserts with stable errors; and expand the real-runtime integration matrix.
  It also identified that request-rate limits can be bypassed by rejoining and that the in-memory
  join limiter needs bounded pruning.
- The follow-up implementation resolves those findings with an atomic fair-start check, a nullable
  active-song key under a supported unique `(party, active_song_key)` index, party/IP request and
  join limiting, a single-playing-item guard, and active controller-session verification before
  handoff. Terminal records clear the key so completed songs can be requested again.
- Final validation passed: PocketBase syntax checks; nine pure backend contracts; real PocketBase
  0.39.7 controller and party integration harnesses using temporary data; `bun test:unit --run`;
  `bun run build`; diff whitespace check; and independent final re-review with no P0/P1 findings.
- Staging deployment evidence (2026-07-21): retained Coolify application `starsummit-pocketbase-test`
  is healthy at signed commit `972551f` on its existing persistent volume. TLS, `/api/health`, and
  SSE passed; party lifecycle access rules, expiry, temporary guests, sanitized queue reads,
  eligibility, duplicate/rate/race handling, fair rotation, idempotent and single-playing
  transitions, and controller `open_video` active-session gating were exercised live. Isolated
  `live-validation-20260721` records remain for later cleanup; no real Fire-tablet enrollment was
  modified and no Wi-Fi interruption was performed.
