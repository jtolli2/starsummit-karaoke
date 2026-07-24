# Admin-Confirmed Public Playlist Import and Safe Bulk Approval

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Replace trusted-source allowlisting as an import authorization gate with authenticated
  `tablet_admin` public-playlist preview, strict local URL/ID parsing, official fixed YouTube Data
  API calls, public ownership/visibility verification, bounded quota/caching, and sanitized errors.
- Bind an explicit, expiring, single-purpose server confirmation to the verified immutable playlist
  snapshot and operator; make import restart-safe, idempotent, delta-only, provenance-preserving,
  and never automatically approve or establish canonical identity for untrusted sources.
- Provide an `/admin` preview/confirmation/import experience that distinguishes known parser
  profiles from admin-confirmed public sources and safely recovers cache, expiry, and retry state.
- Add source-scoped `Select all approvable` / clear-selection review controls with opaque server
  snapshots, policy revalidation, bounded idempotent chunks, durable audit, and no cross-scope or
  stale-row approval.
- Preserve guest, party, queue, controller, existing catalog, all eight retained exception rows,
  volume, snapshots, claims, quota, history, and curation. Document the approved architecture and
  validate locally, against PocketBase 0.39.7, in independent review, and on retained staging.

## Constraints and Notes

- Only constrained authenticated `tablet_admin` sessions may call preview, confirmation/import, or
  review routes. Browser code has no YouTube, PocketBase superuser, Coolify, controller, or Lounge
  secrets and never writes privileged collections directly.
- Accept only playlist IDs, normal YouTube playlist URLs, and legacy `channelId:playlistId` source
  keys. Never fetch arbitrary URLs, scrape HTML, use InnerTube/yt-dlp, or follow redirects.
- Unknown owners are permitted only after public metadata verification and explicit operator
  confirmation. Uploader/channel metadata is provenance only; unknown-source parsing remains
  untrusted and cannot establish canonical artist/title or broad guest eligibility.
- Never delete/reset records, replace the external volume, change production DNS, use the backup
  API key automatically, mutate tablet enrollment/Lounge pairing, or run the deferred Wi-Fi test.
- Standing approval from the delegated request covers scoped local and retained-staging mutations,
  commit/push to existing `main`, official bounded YouTube calls, and Coolify deployment. Report
  every remote mutation without secrets.

## Implementation Notes

- 2026-07-24: Loaded and started from the delegated feature request. Baseline is clean and both
  local `main` and `origin/main` resolve to `8f236ff43d8c198e0b10bc5536cb031bd79e1832`.
- Discovery, implementation, validation, review, staging evidence, and completion history follow.
- 2026-07-24: Implemented strict public playlist input parsing, durable admin-bound preview
  confirmations, authoritative import revalidation, cached-preview confirmation renewal, and
  server-only source/filter-bound bulk selection with resumable approval operations. Focused parser
  tests (9), focused Vue tests (22), production build/type-check, hook syntax, and multiple
  independent security reviews passed. Pinned runtime and retained-staging evidence are recorded
  separately where available.
