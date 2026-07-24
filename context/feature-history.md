# Feature History

> Append-only record of completed features and fixes. Add a dated, concise entry after completion; do not edit, reorder, or remove earlier entries.

## Entries

### 2026-07-22 — Karaoke Catalog Import and Search

- Added a private, resumable catalog import contract with immutable manifest/chunk fingerprints,
  deterministic fixture planning, source provenance, normalized song identity, candidate
  classification/confidence, review state, alternatives/history fields, and replacement handling.
- Guests receive only approved eligible-song search results through their existing temporary
  party credential; constrained `tablet_admin` users can inspect, review, and replace catalog
  items without direct collection writes or browser YouTube credentials.
- Karaoke is preferred. `fallback_lyric` and `fallback_audio` records remain explicitly
  ineligible and replaceable; live YouTube discovery returns a clear unavailable response until a
  server-only API boundary and real source are provisioned.
- Focused importer/hook tests, Vue API tests, production build, and independent review passed.
  Pinned PocketBase integration remains environment-gated. A retained-staging audit found both
  apps healthy but PocketBase still on `6f1c8ac`; no deployment capability was available in this
  task, so no catalog records/configuration were changed and no live catalog validation is claimed.

### 2026-07-22 — Server-only YouTube catalog discovery hardening

- Added a server-side YouTube Data API discovery path with batched video metadata lookup,
  embeddable/public/processed filtering, explainable classification, and no browser key exposure.
- Added durable Pacific-day quota claims with pessimistic reservation, request ownership/leases,
  stale-owner fencing, persisted payload replay, failure accounting, and zero-result idempotency.
- Focused backend contracts, production build, and independent review passed. Deployment and live
  quota validation are still pending an available Coolify deployment action.

### 2026-07-22 — Controller realtime subscription authorization fix

- Corrected the guest wake hook so it authorizes only subscriptions that include
  `karaoke_party_wake`; controller command subscriptions now continue to PocketBase's normal
  controller record rules with their original identity intact.
- Retained-staging PocketBase deployed `6f1c8ac`; the Fire companion accepted the realtime
  subscription and processed a realtime-woken `open_video` handoff as controller sequence 64,
  acknowledged `succeeded`. The HTTPS polling fallback remains available for unrelated future
  subscribe-time failures.

### 2026-07-22 — Controller realtime authorization recovery

- Added a narrow native-companion recovery path for the retained staging PocketBase realtime
  subscription authorization mismatch: only an HTTP 403 while subscribing falls back to a
  two-second authenticated HTTPS command refetch loop. Other realtime failures keep the existing
  reconnect/error behavior.
- Added redacted endpoint/phase/fallback diagnostics and JVM coverage. The companion never exposes
  controller credentials, session material, or Lounge pairing data in logs or its UI.
- On retained staging, an isolated guest request was started through the normal tablet endpoint;
  the companion polled command sequence 63 and PocketBase marked its `open_video` command
  succeeded. A repeated tablet transition returned the server's idempotent `playing` result.

### 2026-07-21 — Tablet Operator Interface

- Added the touch-first `/tablet` operator experience with constrained `tablet_admin` sign-in,
  recoverable session/active-party restoration, explicit 12-hour party creation, QR join display,
  sanitized queue/controller state, and accessible guarded queue actions.
- Added tablet-only authoritative status and active-party recovery routes, a forward party-owner
  migration, expiry/monotonic transition protection, and a controller handoff guard that requires
  a fresh current-generation connected heartbeat before a queue entry can become playing.
- The browser never receives PocketBase superuser, controller-device, or Lounge material; playback
  remains an idempotent PocketBase command for the native controller. `/admin` was intentionally
  not added because `/tablet` is the single constrained operator/display surface.
- Passed focused Vue tests, backend protocol tests, production build, migration/hook syntax, and
  independent security/concurrency review. Pinned local PocketBase integration is environment
  gated; retained-staging live validation is recorded separately after delivery.

### 2026-07-20 — Fire tablet native companion diagnostic spike

- Added a standalone API 28 Kotlin companion with a foreground service, Android Keystore-backed
  Lounge pairing persistence, redacted diagnostics, serialized playback commands, and guarded
  reconnect/session lifecycle behavior.
- Proved SmartTube TV-code pairing, open-video, play, pause, seek, playback-state reporting, and
  encrypted credential restoration after a controlled companion process interruption on the
  Amazon KFTRWI/trona Fire tablet.
- Validated the debug APK with 15 JVM tests and `assembleDebug`; independent review found no
  remaining blocking correctness or security issues. PocketBase integration and explicit Wi-Fi
  interruption testing remain deferred.

### 2026-07-20 — PocketBase native controller protocol

- Added separate controller-device enrollment/authentication, resumable monotonic sessions,
  validated/idempotent commands, atomic terminal acknowledgements, and sanitized state reporting
  in a pinned PocketBase 0.39.7 backend.
- Integrated the Fire tablet companion through HTTPS and PocketBase SSE wake hints with encrypted
  controller credentials/progress, authoritative refetch, ambiguous-send reconciliation, bounded
  reconnect, and preserved Lounge isolation.
- Passed real PocketBase authorization/concurrency/SSE integration, six backend contract tests, 31
  Android JVM tests, Android assembly, Vue unit/build validation, and an independent final review
  with no remaining actionable findings. Live deployment, enrollment, and tablet mutation remain
  approval-gated.

### 2026-07-21 — Party Lifecycle and Fair-Rotation Queue Request API

- Added versioned PocketBase party, temporary guest, karaoke-song eligibility/provenance, and queue
  schema plus server-only party join, sanitized queue, request, fair-start, and tablet transition
  routes. Codes and credentials are server-hashed; parties and guest access expire after 12 hours.
- Enforced deterministic requester rotation, direct-write/read boundaries, durable active-song
  uniqueness, rate limiting, idempotent transitions, and native-controller `open_video` handoff
  guarded by an active controller session.
- Passed pinned PocketBase 0.39.7 authorization, expiry, rate, race, rotation, transition, and
  controller-handoff integration coverage; backend contract tests; Vue tests; production build;
  and independent final security/concurrency review.

### 2026-07-21 — Guest Party Interface

- Added the responsive file-based `/party/[code]` guest experience with temporary party-scoped
  session credentials, sanitized queue states, eligible-song browse/search, and validated requests
  with clear duplicate, rate-limit, expiry, and loading/error feedback.
- Added a party-scoped, payload-free PocketBase SSE wake topic with strict temporary-credential
  authorization; all queue state is recovered through the existing authenticated HTTPS endpoint.
  Guests retain no tablet/admin controls or privileged credentials.
- Passed focused Vue tests, production type-check/build, PocketBase hook syntax checks, and final
  independent review. The local pinned-runtime integration harness was unavailable and skipped;
  validate custom wake delivery against it before any deployment validation.

### 2026-07-21 — Guest Party Interface staging delivery evidence

- Deployed exact commit `0de3c6f3c9f595b2942b3562e7a4554f9fe81c6e` to the retained
  `starsummit-pocketbase-test` Coolify application without replacing its persistent volume.
  Deployment health and public `/api/health` passed; unauthenticated guest API reads remained
  denied as designed.
- Live guest-page validation is blocked by the intentional container boundary not yet provisioned
  in Coolify: the retained PocketBase-only application returns 404 for `/party/<code>`. A separate
  frontend application/container with same-origin routing must be created before browser flow and
  live guest SSE validation can proceed.

### 2026-07-21 — Frontend Container and Same-Origin Routing

- Added a multi-stage Bun-to-Nginx frontend container with deep-link SPA fallback, strict missing
  static-asset 404 behavior, health checks, and a same-origin `/api` proxy. PocketBase realtime
  SSE is unbuffered with long read/send timeouts; forwarded scheme and client-chain handling are
  constrained for Coolify ingress.
- Added an approval-gated Coolify Compose topology: frontend is the only public service and
  PocketBase remains private with an explicitly selected pre-existing external data volume.
  Documented the production hostname and a non-mutating retained-staging plan.
- Passed Docker container integration coverage for static serving, deep routes, API proxying,
  realtime streaming, and built-asset secret scans; passed Vue unit tests, production build,
  Compose rendering, and independent final review. No commit, deployment, DNS/resource change,
  volume action, or retained staging mutation was performed.

### 2026-07-21 — Frontend Container staging delivery evidence

- Pushed `7f55f116cf4205fd52b57ab6a34184eeec7a3b0c`; redeployed the retained PocketBase staging
  application on its existing persistent volume with a stable private `pocketbase-staging` alias.
  Created the separate frontend staging application `f3b92sq9dy8y5ernb1nw9cfs` at
  `https://karaoke-test.app.starsummit.net`, proxying same-origin `/api` to that private alias.
- Coolify reported both applications healthy. HTTPS checks passed for `/healthz`, an SPA deep
  route, backend `/api/health`, a missing asset 404, and PocketBase realtime SSE. A browser loaded
  `/party/DEMO1234` and correctly rendered the backend-provided expired-party state. No backend
  records, persistent volume, controller enrollment, tablet state, production hostname, or
  deferred Wi-Fi interruption test was changed.

### 2026-07-22 — Karaoke Catalog Import and Search staging delivery

- Retained PocketBase staging deployed exact commit
  `53dfa1c70e0cf878f297b85250475ba849e39fbc` successfully after additive repairs for the
  partially restored catalog, quota, claim, and payload collection migrations. Coolify health and
  public `/api/health` passed; the retained persistent volume was neither replaced nor cleaned.
- The server-side `YOUTUBE_API_KEY` configuration was applied without exposing its value. Live
  unauthenticated probes confirmed guest catalog search and the tablet catalog import route both
  return 403, preserving their credential boundaries. No import was started because no scoped
  `tablet_admin` credential and approved source manifest were available in this delivery step; no
  catalog or unrelated retained records changed, and no YouTube quota was intentionally consumed.

### 2026-07-22 — Karaoke Catalog Import and Search

- Added a resumable, idempotent server-side catalog importer with immutable source provenance,
  normalized identity deduplication, durable YouTube request claims and quota ledger, batch metadata
  validation, configurable karaoke-first scoring, explicit fallback classifications, review state,
  replacement handling, and auditable alternatives.
- Added constrained tablet-admin catalog review/search/approve/reject/replace/disable workflows and
  party-independent review UI. Guest search exposes only sanitized approved/eligible songs with
  normalized deterministic pagination; public writes and privileged YouTube access remain denied.
- Passed 32 importer/backend contracts, two pinned PocketBase 0.39.7 migration integrations, 15 Vue
  tests, production build, and independent final review. Deployed product SHA
  `8dd12a9e102ab0dc28dc94c045cf9b83c3cf7750` to both retained staging apps without replacing the
  volume; live replay, quota, review, guest-boundary, no-party recovery, and health checks passed.
- Live validation added two unreviewed/ineligible karaoke candidates and one rejected/ineligible
  synthetic fixture, consuming 101 known YouTube quota units. A real reproducible popular-song
  source and broad initial import remain intentionally deferred rather than fabricating provenance.

### 2026-07-22 — Popular-Song Source Selection and Initial Catalog Population

- Selected ordered MusicBrainz recording series (Rolling Stone 2021 and Billboard Year-End Hot
  100 lists) under CC0 core-data terms. Added a rate-limited, transient-retry-safe planner that
  preserves canonical artist-credit display, stable recording/list/rank identity, retrieval time,
  digest, genres, release year, deduplication, artist concentration, and per-song quota checkpoints.
- Separated canonical song identity from YouTube uploader provenance throughout import, replay,
  alternatives, review, correction, replacement, fallback, tablet reporting, and guest search.
  Legacy rows are forward-only quarantined and audited; constrained corrections cannot silently
  approve a song. Added coverage/quality reporting and distinct operator presentation.
- Passed 36 backend contracts, three pinned PocketBase 0.39.7 integrations, 15 Vue tests, the
  production build, focused source tests, syntax/whitespace checks, and two independent final
  reviews. Whole-repository Oxlint remains red only on pre-existing hook/migration/test debt.
- Deployed product SHA `5a9170586533352c78d45456479a5ad142fcafde` to both retained staging
  apps. All 16 retained catalog rows, including `nMDXPAM8RwE` and `9iQH7g_zKl8`, were preserved,
  audited, marked `needs_review`, and made ineligible. The suspect pair remains flagged for
  constrained canonical correction/deduplication; no channel was promoted to artist.
- A live five-song MusicBrainz manifest covered five Billboard years and modeled 505 expected
  YouTube units. No discovery/import request was submitted without a constrained tablet-admin
  credential, so the quality stop left zero new records and zero known new YouTube spend. The
  retained volume and unrelated party, queue, controller, enrollment, production, and Wi-Fi state
  were unchanged.

### 2026-07-22 — Popular-Song Source staging population continuation

- Used constrained tablet-admin access to audit-correct `nMDXPAM8RwE` to canonical Rick Astley /
  Never Gonna Give You Up without approval or eligibility. Preserved `9iQH7g_zKl8` as an
  ineligible missing-identity alternative because the canonical identity already belongs to the
  corrected primary; neither record was deleted.
- Ran the real five-song MusicBrainz manifest. The first discovery retained nine candidates and
  spent 101 YouTube units. Exact replays spent zero further quota but exposed a retained
  PocketBase JSON-scalar checkpoint incompatibility, so broad population stopped. Repaired the
  ready claim's stale per-record reservation from 303 to 0 while preserving its payload and quota
  ledger; the eight unused candidates remain recoverable.
- Imported one representative already-paid candidate through the same idempotent fixture contract:
  Simon & Garfunkel / Bridge Over Troubled Water, Billboard 1970 rank 1, uploader Atomic Karaoke,
  karaoke confidence 92%, unreviewed and ineligible. Final staging holds 18 songs and eight
  alternatives; all 18 remain in the review backlog and guest eligibility was not broadened.
- Deployed product SHA `50acaa8c92a34d6e94e037351655e07b04d324f0` to retained PocketBase
  (`vvnypl84x804g5uz7gcy2vxe`) and frontend (`larll0lgs0l1sk941vc942go`) with the existing volume.
  Passed 15 Vue tests, production build, 39 catalog contracts, 58 backend tests, pinned PocketBase
  catalog/party/realtime integrations, same-origin health, live report, tablet review rendering,
  and repeated independent review. Test-only fixture commit `7ab995e` was pushed afterward.

### 2026-07-22 — Catalog Import Replay Compatibility and Audited Population

- Added a strict PocketBase 0.39.7 JSON compatibility boundary: authoritative `getString` parsing
  for JSONRaw wrappers, exact scalar/native-array/native-object preservation, native JSON writes,
  deterministic digest serialization, and fail-closed handling for malformed, undefined,
  non-finite, cyclic, or ambiguous values. Unknown retained shapes are quarantined; only the fully
  pinned nine-item canary claim received a forward repair.
- Made ready-claim recovery transactional and monotonic across durable chunk resume, exact replay,
  restart reconciliation, concurrent commits, conflicts, expiration/reclaim, and quota settlement.
  Replay count and bounded audit history are durable; inconsistent ready reservations fail closed
  without stranding or double-releasing quota.
- Live retained canary `dy36tlhzi17ew1p` completed from ready against its already-paid durable chunk,
  replayed exactly, survived a PocketBase container restart, and reconciled exactly again. It kept
  spent 101/reserved 0, created no duplicates, and consumed zero additional YouTube units.
- The four-song representative tranche modeled 404 units and stopped on its first request under the
  material-error policy. `Shadow Dancing` spent 101 units, imported zero, and failed closed on an
  explicit undefined optional value; claim `rswrd2ktm5cf6yq` retained failed/spent-101/reserved-0
  evidence and the global ledger settled at spent 404/reserved 0. No later song was attempted, no
  candidate was approved, and the catalog/review backlog remained 18/18.
- Fixed the discovered optional-value defect by representing unavailable external classification
  as JSON `null`; final classification remains derived from video evidence and uploader/channel
  remains provenance-only. Independent review returned APPROVE after each repair.
- Live tablet validation exposed the Bridge alternatives JSON as a recursively serialized byte
  wrapper. Reconstructed the field from the authoritative claim as eight candidates (five karaoke,
  two lyric fallbacks, and one live exclusion), preserved canonical Simon & Garfunkel identity and
  distinct uploader provenance, and appended an `alternatives_json_wrapper_repair` audit event.
  Final tablet diagnostics show 18 songs, 18 awaiting review, and eight alternatives.
- Passed 65 backend and pinned PocketBase tests, 15 Vue tests, production build, hook syntax, and
  Compose validation. Signed product commits through `204d0f6812b32fbac029e7b82007593eebdac4c4`
  were pushed and deployed healthy to retained PocketBase (`i14gl0508juv9pjvy05x1hdz`) and frontend
  (`xzok7k4as8d5lf3bi3x86wrx`) without replacing volume `ggkfvh2tpdprcocn1sycu8zf`.
# 2026-07-22 — Fuzzy Local Search with Quota-Safe YouTube Fallback

### 2026-07-23 — End-to-End Party Dress Rehearsal and Hardening

- Consolidated retained staging into one Coolify Compose application while preserving the exact
  external PocketBase volume, separate frontend/backend containers, explicit ingress hosts, and an
  isolated private backend alias. Former applications, the pre-cutover backup, and the parser-created
  unused storage artifact remain retained because cleanup was not authorized.
- Ran a fresh four-guest party through local fuzzy search, one explicit bounded YouTube fallback and
  cached replay, duplicate/rate/idempotency checks, deterministic requester rotation, SSE wake plus
  authoritative refetch, tablet refresh, Compose restarts, and a controlled native companion process
  restart. Real Lounge commands acknowledged and converged on sanitized tablet now-playing state.
- Fixed PocketBase-normalized controller liveness filtering and a composite-unique terminal queue
  defect. Terminal rows now receive distinct `terminal:<queue-id>` keys, releasing video IDs for
  re-request while preserving atomic completion/failure and bounded failure reasons. Unexpected
  transaction details are normalized before reaching clients.
- Verified multiple completions, one failed song with a clear reason, completed-song re-request,
  command replay safety after restart, guest identity recovery, mobile/Fire layouts, and an empty
  final active queue. Added the repeatable go-live checklist and completed independent review.
  Automated backup-key failover remains a separately scoped post-MVP enhancement.
- Added tablet Play/Pause controls backed by party-owned, active-video, fresh-controller,
  monotonic-command enforcement. Durable operation keys survive ambiguous browser retries, replay
  and equivalent-pending reuse are party/queue/operator scoped, and the UI distinguishes requested
  from authoritatively confirmed state. Live Fire/SmartTube pause and resume both completed through
  realtime wake, refetch, Lounge 2xx, acknowledgement, and authoritative state convergence.

- Added a sanitized, deterministic approved/eligible catalog index and a Fuse.js guest search with
  local debounce, typo/alias/accent normalization, weak-match suggestions, five-minute cache refresh,
  and offline safe-index fallback.
- Added explicit authenticated fallback discovery with private policy-versioned claims, cache expiry,
  durable guest/party/global controls, quota reservation/spend settlement, conservative stale-claim
  recovery, party/guest-scoped candidate grants, and at most five sanitized karaoke candidates.
- Added the distinct party-scoped selected-candidate request path. It preserves queue idempotency,
  rotation, active duplicate and rate protections; any fallback song remains unreviewed and ineligible,
  with YouTube presentation metadata never used as canonical artist/title.
- Local evidence: 9 focused Vue tests, 27 backend contracts, production build, hook/migration syntax,
  whitespace, and independent security/concurrency review. Pinned PocketBase runtime, commit/push,
  retained staging deployment, and live quota/cache validation remain pending.

## 2026-07-22 — Fuzzy Local Search staging completion

- Pushed product repairs through `de117ca` and deployed retained PocketBase staging SHA `de117ca`;
  the frontend remains healthy at SHA `4fcd803`. Coolify CLI deployment preserved volume
  `ggkfvh2tpdprcocn1sycu8zf`.
- Isolated party `8BDNGB7N` replayed the cached exact query `bridge over troubled water karaoke`
  without a new YouTube lookup, showed four sanitized high-confidence karaoke candidates, queued one
  candidate through the party-scoped path, then proved the 30-second guest rate limit and the active
  duplicate rejection. The original representative lookup spent the modeled 101 YouTube units once.
- The fallback queue path now handles absent PocketBase finder results and unique-index races
  transactionally, returning idempotent replay or correct rate/duplicate responses. Independent
  follow-up review approved the final repair; focused pinned contracts passed 27/27.
- No approved local hit exists to exercise in retained staging: all 18 catalog records remain
  unreviewed/ineligible by design. Fuse behavior is covered locally; no catalog record was approved
  to manufacture live evidence. The newly queued discovery retains missing canonical identity,
  remains unreviewed/ineligible, and stores channel/uploader provenance separately.

## 2026-07-23 — Approved-local fuzzy validation follow-up

- The user reviewed and approved two existing songs only: Bridge Over Troubled Water / Simon &
  Garfunkel and Never Gonna Give You Up / Rick Astley. No other catalog, queue, party, controller,
  or retained-volume record was changed by this follow-up.
- Live guest validation on retained isolated party `8BDNGB7N` showed `nevver gona give you up` as
  the approved Rick Astley result without a Search YouTube affordance. The local Fuse score is
  0.511. This corrected a score-zero defaulting issue and raised the documented weak-match cutoff
  from 0.42 to 0.55 so ordinary multi-character typos stay local; empty and genuinely weak results
  still require an explicit fallback action.
- Focused Vue/API tests (13), production build, whitespace check, and independent review passed.
  Pushed `3f52025` (score-zero handling) and `2990ef0` (strong typo threshold), then deployed
  frontend `2990ef05b3f3aaa10f87d6dfc8e0c4d88c93e9dc` successfully through Coolify. No YouTube
  fallback was invoked and no additional quota was spent.

## 2026-07-24 — Trusted Karaoke Playlist Import completion

- Delivered the server-only, allowlisted public-playlist importer with immutable source/snapshot
  provenance, ownership checks, exact video-ID metadata batching, durable quota/claim replay, and
  constrained tablet preview, review, canonical-correction, replacement, coverage, and selected
  batch-approval workflows. Imported candidates remain private until canonical identity and karaoke
  quality gates are independently satisfied.
- Added guest fallback improvements: hidden server-side karaoke query normalization, channel
  provenance, identifiable missing-identity queue rows, explicit catalog-versus-YouTube outcomes,
  quota-safe replay/concurrency handling, and a forced sanitized catalog refresh before fallback
  so newly approved songs appear without consuming a YouTube search.
- Tablet review rows now show exact YouTube IDs and safe direct watch links for fallback and
  playlist candidates. Bounded MusicBrainz-backed curation reduced the retained review backlog
  from 44 to 22 without bulk-approving ambiguous, promotional, or fixture records.
- Retained Compose staging deployed and verified exact product SHA
  `0f4e6210a0ba9b3aa15a8c02867a88d837942dd0` as deployment
  `ek469126wbdozloq2g0n7sjc`; frontend, same-origin API, and controller health returned 200.
  Focused/backend/pinned-runtime suites, production builds, contract checks, and independent
  security, API-policy, concurrency, attribution, and UI reviews passed. No records, volumes,
  rollback resources, or retained artifacts were deleted or replaced.

## 2026-07-23 — Simplified Tablet Operator Interface

- Split the existing all-in-one tablet route into a touch-first `/tablet` operator surface and a
  retained `/admin` advanced-administration surface. `/tablet` preserves QR/party identity,
  authoritative controller state, durable idempotent playback retry, fair queue operation, and
  an intentional Advanced Admin handoff without adding browser secrets or direct collection writes.
- Added anonymous requester labels and a server-calculated fair-rotation projection to the
  sanitized tablet status response. Verified 37 Vue tests, production build, focused controller/
  queue protocol tests, hook syntax, formatting/diff checks, responsive shell inspection, and an
  independent review. No remote deployment, PocketBase data mutation, or tablet action occurred.
