# Sing King Trusted Playlist Preview Recovery

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Prove the exact preview rejection path for the specified Sing King channel/playlist without an
  import, catalog mutation, or avoidable YouTube API quota spend; verify public playlist ownership
  and metadata using authoritative evidence.
- Add only the verified Sing King source/playlist allowlist entry and deterministic parser support;
  retain ambiguous identities as `needs_review` and ineligible, with no identity inferred from
  channel/uploader provenance.
- Return distinct sanitized preview errors for malformed input, untrusted source, ownership mismatch,
  unavailable playlist, quota, and transient provider failure, and present them clearly in `/admin`.
- Add focused backend, pinned PocketBase 0.39.7, parser, Vue/API, authorization, ownership,
  error-mapping, replay, quota, and secret-boundary tests; build and independently review the fix.
- Do not commit, push, deploy, alter Coolify/PocketBase configuration, or mutate retained staging
  catalog data until separately approved. Once the fix is approved and deployed, supervise the
  already-approved constrained tablet-admin import and curation of exactly
  `PL8D4Iby0Bmm-uQIcbRfHeUMd_YDSZDA39`.

## Constraints and Notes

- The allowlist change must be narrow and evidence-backed: exact channel
  `UCwTRjvjVge51X-ILJ4i22ew` and playlist `PL8D4Iby0Bmm-uQIcbRfHeUMd_YDSZDA39` only.
- Preserve KaraFun sources, catalog curation, quota ledgers, snapshots, claims, parties, queues,
  controller/tablet enrollment state, and the retained external volume. No deletion, cleanup,
  replacement, fallback-key use, or Wi-Fi interruption test is allowed.
- `/admin` continues to use only the constrained `tablet_admin` session. Browser code must never
  contain a PocketBase superuser, YouTube/Coolify/Lounge secrets, raw privileged records, or direct
  collection writes.

## Implementation Notes

- 2026-07-24: Feature loaded and started from the failed constrained `/admin` preview. Read-only
  diagnosis and local non-destructive edits/validation are authorized; delivery and remote import
  remain approval-gated as stated in Goals.
- Read-only source evidence confirms public playlist `PL8D4Iby0Bmm-uQIcbRfHeUMd_YDSZDA39` is
  "Party Starters Karaoke | Sing King Karaoke", attributed to channel
  `UCwTRjvjVge51X-ILJ4i22ew` (Sing King), with 416 currently listed videos. Its public description
  identifies a karaoke party mix; this supports one exact source pair, not channel-wide access.
- Root cause: retained staging's configured allowlist has two KaraFun entries but not the exact
  Sing King pair. The API rejects it as `playlist_source_not_allowed` before claim creation or any
  YouTube request. The pending delivery action will append (not replace) the verified pair to that
  existing server-only JSON configuration, after explicit approval.
