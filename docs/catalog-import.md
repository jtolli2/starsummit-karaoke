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

`node pocketbase/catalog/plan-fixture-import.cjs` prints the exact fixture chunk request shape.
Fixture imports consume zero YouTube Data API quota. Live discovery deliberately returns
`youtube_import_unavailable` until a server-side YouTube Data API request boundary is provisioned
with `YOUTUBE_API_KEY`; clients must never provide that key.

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
