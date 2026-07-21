# Guest Party Interface

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Add the phone-first file-based guest route `/party/[code]` and make the generated router render it.
- Join through the existing party-code endpoint, retaining only the temporary party-scoped credential
  needed for later same-origin API calls; never expose privileged credentials.
- Show the sanitized queued/playing queue and eligible stored-song search/browse results.
- Submit requests only through `POST /api/karaoke/requests`, with actionable join, load, search,
  request, duplicate, rate-limit, and expiry messages.
- Treat PocketBase SSE as a wake hint only; reconcile with authoritative HTTPS queue refetches.
- Deliver accessible, responsive phone-first loading, empty, success, and error states with
  proportionate frontend tests.

## Constraints and Notes

- Reuse existing local backend contracts and staging records only through read-only same-origin
  client calls. Do not deploy, mutate staging, or run the deferred Wi-Fi interruption test.
- Guests cannot control playback or access tablet/admin operations. Direct PocketBase collection
  writes and browser secrets are prohibited.
- The existing backend exposes party join, sanitized queue, and request endpoints. The stored-song
  browse/search endpoint contract must be inspected before implementation; do not invent a fallback
  YouTube search contract.
- The future 5,000-song import remains out of scope and must only import eligible karaoke backing
  tracks when separately implemented.
- Added a server-authorized custom `karaoke_party_wake` PocketBase topic. It carries `{}` only,
  tags realtime clients with the verified party ID, and triggers authoritative HTTPS queue refetches;
  the client also reconnects with capped backoff and keeps a 30-second HTTPS recovery poll.
- Validation passed: focused Vue tests (three files, five tests), production type-check/build, and
  PocketBase hook syntax checks. The existing real PocketBase party integration harness was skipped
  because its local runtime prerequisite was unavailable; custom wake delivery remains unexercised
  against a live pinned runtime and must be covered before deployment validation.
- Independent final review approved the repaired credential retry and guaranteed hook continuation;
  no P0/P1 findings remain. No deployment, staging mutation, tablet action, or Wi-Fi interruption
  was performed.
- Staging delivery evidence (2026-07-21): Coolify deployment `w1yvup5abhkormddjuz4z4fm`
  imported and rolled out exact commit `0de3c6f3c9f595b2942b3562e7a4554f9fe81c6e` against the
  retained `starsummit-pocketbase-test` volume. The backend health check and public `/api/health`
  passed; unauthenticated queue and song access correctly returned `guest_credential_required`.
  The guest page returned 404 because this retained application is PocketBase-only (`/pocketbase`
  base directory); a separate frontend container/application and same-origin routing are still
  required before a live phone-route, join/search/request, or browser-SSE check can be performed.
