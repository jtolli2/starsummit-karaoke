# Catalog import and review

Catalog imports run through PocketBase only. The browser never receives a YouTube API key and the
private `karaoke_songs` collection has no direct public write rule.

## Input contract

The committed fixture at `pocketbase/catalog/fixtures/karaoke-manifest.json` is a deterministic
pipeline fixture, not a claim that its entries are a live popular-song source. Its accompanying
read-only planner creates an immutable SHA-256 manifest fingerprint and requests of at most 100
items. A real import must supply a legally/operationally suitable popular-song source URL, terms
note, retrieval timestamp, rank order, and its complete stable manifest fingerprint. Replaying a
chunk is safe; changing a manifest or chunk is rejected; chunks must arrive contiguously.

### Claim replay and retained-data repair

Live discovery is represented by a durable `karaoke_youtube_claims` row. A `ready` or `complete`
claim is authoritative: its persisted payload, source/chunk fingerprints, digest, spent units, and
quota day are reused on an unchanged replay, so replay performs no YouTube request and consumes zero
additional quota. An expired lease may be reclaimed, but reservation release is recorded separately
from actual spend; a stale owner cannot commit or release another owner's claim. `audit_json`,
`replay_count`, `lifecycle_reason`, and `reservation_released_at` provide bounded operator
diagnostics without exposing query payloads or credentials.

The forward-only claim repair migration (`1784513100_repair_catalog_claim_lifecycle.js`) audits
retained rows (the preceding `1784513000_claim_audit_fields.js` adds the diagnostic fields). Legacy
rows whose JSON payload is a native scalar, string
wrapper, or malformed value are retained and marked `failed` with `legacy_payload_quarantined`; their
spend ledger is not erased. Rows with a valid object payload remain replayable. Applying the migration
twice is a no-op, and no rollback path deletes claim, quota, import, or song records. Run the pinned
runtime proof with:

```sh
POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/catalog_replay.integration.node.cjs
```

The selected real source is ordered MusicBrainz recording series for the Rolling Stone 2021 list
and available Billboard Year-End Hot 100 lists. See
[catalog-source-policy.md](catalog-source-policy.md). `plan-musicbrainz-series-import.cjs` resolves
canonical MusicBrainz recording/artist credits, preserves list/rank, caps artist concentration,
rejects missing/ambiguous identity, deduplicates normalized identity, records the retrieval instant
and source digest, and reports expected YouTube quota before discovery. Each canonical song gets a
deterministic independent batch/checkpoint; this makes exact replay free and prevents one failed
song from blocking the corpus cursor.

`node pocketbase/catalog/plan-fixture-import.cjs` prints the exact fixture chunk request shape.
Fixture imports consume zero YouTube Data API quota. Live discovery is requested with
`fetchFromYoutube: true`, a query, an explicit `canonical` source object, and the same immutable
batch/manifest fields. PocketBase reads
`YOUTUBE_API_KEY` from its server environment, reserves a bounded maximum of 303 credits per
request (three search retries at 100 credits plus three metadata retries),
and stores only filtered public, processed, embeddable candidates plus availability metadata.
Transient API failures are retried briefly and recorded as a redacted run error; the key is never
returned or logged.

Canonical title and artist are mandatory for live discovery. They come from the source manifest or
an audited operator correction. YouTube `snippet.title`, `channelTitle`, and `channelId` are stored
separately as video provenance and may affect matching/classification only; they never populate or
replace song identity. Missing or uncertain identity is ineligible and cannot be approved.

## Candidate policy

Signals from title, description, and channel metadata produce explainable heuristic
classification/confidence only. `karaoke` is preferred. Live performances, official originals,
misleading/unrelated material, and ordinary covers are not eligible. `fallback_lyric` and
`fallback_audio` remain ineligible and visible to a constrained `tablet_admin` for review or
replacement. Approval makes only a `karaoke` classification eligible for guest search and queue
requests.

The importer stores source fields, normalized artist/title identity, video metadata, review state,
alternatives/history slots, and replacement provenance. It deduplicates by YouTube ID and never
overwrites an existing operator curation decision. A replacement must already be approved,
eligible, and classified `karaoke`.

## Operator and guest boundaries

`tablet_admin` users may list catalog records and change review/replacement state via protected
PocketBase routes. Guests only receive sanitized, deterministic, paginated results from approved
eligible songs using their temporary party credential. Direct collection writes remain denied.
The tablet catalog report summarizes source, classification, review state, identity state, decade,
confidence, missing identity, alternatives, unavailable items, and unresolved backlog. Canonical
identity corrections require artist, title, and reason, append before/after audit history, return
the record to `needs_review`, and never make it eligible automatically.
