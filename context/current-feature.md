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
- Add a bounded, explicitly selected tablet batch-approval action (maximum 20 records) that
  preserves the existing karaoke/identity gates, confirms the selected count, and writes a
  per-song batch audit event. Blanket or filter-based approval remains out of scope.
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
- Staging now contains the repaired private schema and exact final diagnostic deployment. The
  allowlisted preview still fails closed before any song record is created; a sanitized upstream
  HTTP operation code was deployed to distinguish source authorization/availability from importer
  state. The existing authenticated tablet session was recovered after redeploy; the next bounded
  canary can use that retained session without a new sign-in.
- The initial KaraFun general playlist was rejected by the authoritative API ownership check and
  remains retained only as a failed, non-destructive claim. The runtime allowlist was corrected to
  the official channel uploads playlist, which passed owner verification. A bounded first-page
  import retained 23 `needs_review`/ineligible candidates and 2 unavailable audit outcomes; it
  created no approvals and did not change the guest catalog.
- Playlist transport now uses the worker-safe hook helper, reserves the bounded retry maximum
  (six preview / nine import calls), records actual operation attempts, and settles unused
  reservation. Further population is deliberately paused for canonical MusicBrainz/operator
  review integration rather than bulk-approving title parses.
- A second verified KaraFun `All Time Top 50` source passed ownership preview and retained 16
  additional `needs_review`/ineligible candidates (9 unavailable audit outcomes). One candidate,
  Toni Braxton / Un-Break My Heart, received an audited MusicBrainz-backed operator identity
  correction but remains unapproved and ineligible pending a refreshed-card review.
- The operator independently checked the corrected KaraFun rendition and approved Toni Braxton /
  Un-Break My Heart. Retained staging now reports three approved catalog records; this approved
  rendition is eligible while the remaining playlist candidates stay private pending one-at-a-time
  review. The next selected candidate must be paged into the constrained tablet UI before any
  correction or approval.
- Further MusicBrainz-backed tablet review approved Passenger / Let Her Go, Peter, Paul & Mary /
  Don't Think Twice It's All Right, Brooks & Dunn / Ain't Nothing 'bout You, and Anne Murray /
  I Just Fall in Love Again. Keith Whitley / Ten Feet Away is corrected but not approved because
  the constrained review page moved it off-screen; direct database mutation was not used. The
  existing pager code needs deployed-runtime diagnosis before that remaining approval can proceed.
- The tablet pager was confirmed usable: Keith Whitley / Ten Feet Away was approved through page 2.
  Lionel Richie / My Love has a verified operator correction and is visibly awaiting approval on
  page 1; browser targeting became intermittent for its nested approval control, so no substitute
  direct-record action was attempted.
- Tablet review continued with stable card-scoped controls: Lionel Richie / My Love, Evanescence /
  My Immortal, and Whitney Houston / I Have Nothing were each MusicBrainz-verified, corrected,
  and approved. The retained review backlog is now 47; no bulk approval or direct record write
  was used.
- Selected-only batch approval is implemented with a maximum of 20 records, exact-name native
  confirmation, UI/server parity for high-confidence karaoke and no alternatives, transactional
  collision revalidation, per-song audit events, and one retained batch-summary audit event.
  Independent review approved the implementation; behavioral pinned-runtime and Vue interaction
  coverage remain a follow-up beyond the current static/focused suite.
- A freshly deployed tablet bundle exposed a review-list compatibility defect: the visible
  `Needs review` filter sent that state while the server's combined actionable backlog was only
  available under its retained `pending` alias. The server now maps both values to the same
  unreviewed-or-needs-review backlog, guarded by the catalog protocol contract. The same runtime
  check exposed a missing worker-local `jsonValue` binding in the catalog route's newly added
  alternatives count; the callback now explicitly loads that helper before serializing rows.
- After the retained staging deployment of those repairs, the refreshed authenticated tablet
  review again rendered its 20-row actionable page. MusicBrainz-backed corrections and approvals
  then added Forrest Frank / `GOOD DAY` and Slipknot / `Vermilion, Pt. 2`; no batch approval,
  fallback approval, direct database edit, deletion, or extra YouTube search was used.
