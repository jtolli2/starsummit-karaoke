# Trusted Karaoke Playlist Import

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Add a server-only, allowlisted public-playlist importer that snapshots exact YouTube video IDs,
  verifies playlist ownership, batches public video metadata, and is resumable, transactional,
  idempotent, and quota-reserve aware without using `search.list`.
- Preserve canonical artist/title boundaries: playlist and uploader metadata are provenance only;
  imported records require a verified MusicBrainz identity or constrained tablet-admin correction
  before approval and guest-catalog eligibility.
- Add constrained tablet review/preview/report support and tests for parsing, pagination, replay,
  quota accounting, authorization, curation preservation, and sanitization.
- Deploy and validate the exact product SHA on retained Compose staging, run a bounded canary and
  quality-gated import/review suitable for Saturday without deleting or replacing retained data.

## Constraints and Notes

- Standing approval covers scoped local, commit/push, Coolify retained-staging, and additive
  PocketBase/data mutations. It does not allow deletion, external-volume replacement, production
  hostname/DNS changes, credential rotation, backup-key automation, controller enrollment change,
  destructive reset, or Wi-Fi interruption.
- `YOUTUBE_API_KEY` remains server-only; `YOUTUBE_API_KEY_BACKUP` is manual-development only.
  Exact playlist IDs are enumerated with `playlistItems.list`; known IDs use `videos.list` batches.
  No scraping, InnerTube, yt-dlp, arbitrary guest playlists, or content copying is permitted.
- The upcoming party is a delivery deadline, not an application quota policy. Unreviewed/ineligible
  candidates remain private and retained.

## Implementation Notes

- Playlist sources are configured server-side only. The tablet sends a configured source key and
  cannot proxy arbitrary public or guest playlists. Every source is revalidated as public and owned
  by its immutable configured channel before a stale snapshot is replayed; fresh owner validation is
  cached for six hours.
- Claims bind the source, policy, page token, and requested page size. They reserve the shared
  YouTube quota ledger before external calls, coalesce active identical work, settle successful
  calls by operation class, and conservatively charge an ambiguous/stale external lease.
- The feature deliberately has no Saturday-specific application quota or reserve. Imported videos
  remain `needs_review` and ineligible unless existing constrained canonical correction and review
  paths establish their identity and approve karaoke quality.
- Retained staging exposed a recorded initial migration without the new private playlist schema.
  The forward-only `1784600010` repair ensures the missing private collections and additive song
  provenance fields without changing any retained records.
