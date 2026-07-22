# Karaoke Catalog Import and Search

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Deliver a server-only, resumable, idempotent, quota-aware popular-song import pipeline with
  reproducible input provenance, candidate classification, safe checkpointing, and auditability.
- Extend the catalog minimally for normalized identity, YouTube provenance/availability,
  classification, confidence, review state, alternatives, replacement, and import-run metadata.
- Provide constrained `tablet_admin` catalog-review endpoints/UI while keeping guests restricted to
  sanitized, approved, eligible catalog search and the existing validated request workflow.
- Implement deterministic title/artist normalization, pagination and ordering, candidate scoring,
  deduplication, replacement eligibility, and explainable rejection reasons without browser
  YouTube credentials or direct public catalog writes.
- Add proportionate importer, backend contract/integration, auth, deduplication and Vue coverage;
  deliver a review, approved commit/push/deploy and retained-staging validation when inputs and
  credentials permit.

## Constraints and Notes

- The initial source is a versioned fixture/import contract carrying source URL, retrieval date,
  rank and terms notes; a live import requires a reachable declared source and a server-side
  YouTube Data API key. Do not fabricate live catalog data if either is unavailable.
- Karaoke candidates are preferred, with `fallback_lyric` and `fallback_audio` visible for review
  and replaceable when stronger candidates appear. API metadata scoring is heuristic, not semantic
  certainty.
- Preserve the retained staging volume and all unrelated party, queue, controller, tablet and
  validation records. No production or Wi-Fi interruption action is in scope.
- Implemented an immutable manifest/chunk importer with source provenance, normalized identity,
  classification confidence, review/replacement state, private operator routes, and sanitized
  guest pagination. The committed fixture is deterministic only; live YouTube discovery is
  deliberately unavailable until a server-side key/request boundary and real source are supplied.
- Verification: 9 importer/hook contract tests, 5 focused Vue API tests, production build, diff
  whitespace check, and independent review passed. Pinned PocketBase integration and retained
  staging validation remain environment/deployment checks.
- Retained staging audit on 2026-07-22: frontend and PocketBase apps were healthy, but PocketBase
  remained deployed at `6f1c8ac7d02095a236249dd53a7eded9d4600b58`. This task exposed read-only
  Coolify inspection only, with no deployment/update action or authorized local token path; no
  staging configuration or records were changed and live catalog validation was not claimed.
- A server-side `YOUTUBE_API_KEY` has now been configured for retained staging. This follow-up
  activates the live discovery boundary, then requires a redeploy before a small catalog-only
  validation import can safely consume quota.
- Added the server-only YouTube discovery boundary with Pacific-day quota accounting, durable
  request claims/payloads, lease recovery, owner fencing, retry-safe metering, availability
  filtering, and idempotent empty-result replay. Fourteen focused backend contracts, production
  build, and final independent review pass. Deployment/live route validation remains pending.
