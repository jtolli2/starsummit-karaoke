# Fuzzy Local Search with Quota-Safe YouTube Fallback

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete — deployed to retained staging and live-validated

## Goals

- Serve a compact, versioned, cacheable approved/eligible-only catalog index for client-side Fuse.js
  search without exposing catalog provenance, review state, ineligible records, or credentials.
- Deliver deterministic local fuzzy search for typo, accent, punctuation, spacing, alias, artist/title,
  and reversed-token queries, with documented weak-match threshold and accessible suggestions.
- Require explicit authenticated party-scoped YouTube fallback on a genuine local miss; coalesce and
  cache normalized exact queries through durable quota/claim machinery so replay costs no quota.
- Enforce server-side query quality, per-guest/per-party/global limits, bounded sanitized results,
  karaoke-first classification, audit history, and fail-closed behavior for unavailable policy or
  accounting dependencies.
- Allow only high-confidence karaoke discoveries to be requested through an auditable party-scoped
  path, preserving canonical/channel separation, unreviewed global ineligibility, duplicate guards,
  fair rotation, idempotency, and wake-only SSE semantics.
- Add focused Vue, backend contract, and pinned PocketBase 0.39.7 integration evidence, deploy the
  exact product SHA to retained staging without replacing volume `ggkfvh2tpdprcocn1sycu8zf`, and
  live-validate one bounded fallback/cache replay using retained isolated records.

## Constraints and Notes

- Standing approval in this feature thread covers scoped local work, commits/pushes to existing
  `main`, retained staging deployment/configuration, and bounded feature validation records/quota.
  No deletion, volume replacement, production/DNS change, tablet/controller mutation, or bulk
  catalog action is authorized.

- No deletion or cleanup is authorized. Do not replace/remove the persistent volume, mutate
  production hostname/DNS, change unrelated Coolify resources, incur paid commitments, mutate the
  tablet/controller, perform destructive resets, or run the deferred Wi-Fi interruption test.
- Canonical artist/title may come only from MusicBrainz/source or constrained operator input.
  YouTube uploader/channel is separate provenance and must never populate canonical artist.

## Completion Notes

- The guest receives a deterministic, safe catalog index and uses Fuse.js locally (0.42 weak-match
  threshold, five-minute cached-index TTL with offline fallback); live fallback is never automatic.
- Four additive private migrations add cache, idempotency, claim/access/rate, expiry, and reservation
  state. Claims are policy-versioned, coalesced, bounded to five candidates, conservatively settle
  external calls at 101 units, and grant access only to the requesting party and temporary guest.
- Selected fallback records retain YouTube presentation text only as `video_title`; canonical identity
  remains explicitly missing, unreviewed, and globally ineligible. Queueing retains normal rotation,
  duplicate, rate, idempotency, and wake/refetch contracts.
- Local verification passed: 11 focused Vue tests, 27 backend contracts, production build, hook and
  migration syntax, whitespace check, and independent security/concurrency review. The final pinned
  staging path was additionally exercised through the retained PocketBase application.
- Product commits through `de117ca` were pushed to `main`; frontend SHA `4fcd803` and backend SHA
  `de117ca` are healthy on retained staging without replacing volume `ggkfvh2tpdprcocn1sycu8zf`.
  Isolated retained party `8BDNGB7N` proved an explicit cached replay for
  `bridge over troubled water karaoke`, at most four sanitized candidates, a party-scoped queue
  request, rate limit, and active duplicate rejection. The one earlier pre-repair explicit lookup
  consumed the modeled 101 units; all later replays and request retries used the durable cache.
- The retained catalog has zero globally eligible songs (all 18 are intentionally still unreviewed),
  so a live approved-local fuzzy hit could not be demonstrated without violating the no-approval
  validation constraint. Focused Fuse tests cover typo, alias, accent, punctuation, reversal,
  ranking, and weak-match behavior. No catalog record was approved; the queued fallback discovery is
  still unreviewed and globally ineligible.
