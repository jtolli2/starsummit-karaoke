# Sing King Trusted Playlist Preview Recovery

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Blocked

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
- Delivery: committed and pushed `004ba933aee9eeffa6eaecd0880d56ba94cde45f`
  (`fix: recover trusted playlist preview`), appended only the verified Sing King entry while
  retaining both KaraFun entries, and deployed it to retained staging as Coolify deployment
  `umg1epvqszqd6y5va3rdc9r0`.
- Live constrained-admin preview succeeded for 25 items. Its first approved import created no song
  rows: `0 imported`, `0 duplicates`, and `25 unavailable`; catalog remains 61 total with 3 awaiting
  review, 17 missing/uncertain identities, and 8 alternatives. The importer deliberately drops a
  row when YouTube metadata is missing, non-embeddable, non-public, or not processed, but records
  only an aggregate count. It does not retain the subtype or an unavailable candidate/audit row.
  The curator verified the exact playlist is public and has 416 visible karaoke entries, made no
  mutation, and paused before any later page or repeated provider call. A follow-up importer
  observability/policy decision is required before resuming: retain unavailable evidence with a
  reason and provide an explicit, quota-accounted revalidation path, or accept the API result as a
  final external availability exclusion.

- 2026-07-24: Implemented the narrow unavailable-diagnosis repair locally. Trusted-playlist imports
  now retain sanitized aggregate reason counts in the durable claim payload and return them on exact
  snapshot replay. Constrained `tablet_admin` may explicitly request `revalidate: true` against the
  exact source/page/snapshot fingerprint; this uses only retained video identities and a
  quota-accounted `videos.list` call, with an idempotent revalidation claim and lease recovery.
  Revalidation never creates catalog rows or exposes raw YouTube metadata. Admin wording now shows
  reason breakdowns and offers a dedicated revalidation action. Structural and focused tests passed;
  behavioral pinned-runtime verification remains pending.

- 2026-07-24: Retained staging diagnosis confirmed all 25 videos had metadata and were public/
  processed but reported `embeddable: false`. Because playback is native SmartTube/Lounge rather
  than an iframe, trusted-playlist eligibility now treats embeddability as informational audit
  metadata: only missing, non-public, or unprocessed videos count unavailable. Public processed
  non-embeddable rows remain needs-review/ineligible without inferred canonical identity. This policy
  change is scoped to trusted-playlist import/revalidation; fallback search policy is unchanged.

- 2026-07-24: Added constrained playlist page continuation in the tablet client. Preview accepts and
  forwards an explicit page token; the admin retains `nextPageToken` only after a successful import,
  then offers an explicit next-page preview control. Each import remains bound to the currently
  previewed snapshot/page, and a new source or first-page preview clears continuation state. No
  automatic page traversal or import was added.

- 2026-07-24: Retained staging import completed all 17 pages (416 playlist entries). The catalog
  retained 385 unique Sing King rows and finished at 446 total records; the remaining 31 playlist
  entries produced no new catalog row because they were duplicates and/or unavailable. All retained
  rows entered needs-review/ineligible with uploader provenance kept separate from canonical identity.
  Constrained tablet curation saved 381 deterministic `Artist - Title` operator corrections. Four
  Sing King rows remain unreviewed/ineligible: two ambiguous formats (`Backing Track`, `Party`) and
  two canonical-identity conflicts (Roxette `It Must Have Been Love`, Wham! `Wake Me Up Before You
  Go-Go`). Catalog identity backlog is 21, equal to the pre-import 17 plus those four retained rows.
  No approval mutation completed: the authenticated admin tab became owned by an orphaned browser
  control session during approval selection and cannot currently be reclaimed; the alternate admin
  tab is unauthenticated. Do not bypass this blocker with superuser writes.

- 2026-07-24: A successful cached page replay exposed sparse `unavailableReasons` formatting in
  `/admin`; the server returned 200 and preserved the continuation, but missing nested reason buckets
  caused the UI to display a generic failure. The formatter now defaults missing buckets/counts to
  zero and has a replay-continuation regression test.
