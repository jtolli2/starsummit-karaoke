# Popular-song source and initial corpus policy

## Selected source

Use ordered MusicBrainz recording series for the Rolling Stone 2021 list and MusicBrainz's available
Billboard Year-End Hot 100 series. Series relationships preserve list membership/rank while
recording MBIDs and artist credits provide canonical identity. MusicBrainz core data is CC0 and its
API provides stable recording identities, artist credits, genres, and release metadata. Requests
identify this application and remain at or below one request per second.

Primary evidence:

- https://musicbrainz.org/doc/About/Data_License
- https://musicbrainz.org/doc/MusicBrainz_API
- https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting

The source is reproducible as a dated snapshot, not an eternal chart: retain endpoint URL, pinned
series IDs, each list/rank, retrieval timestamp, MusicBrainz recording ID, complete
manifest fingerprint, and the exact policy version. Re-running later intentionally creates a new
batch and digest.

## Rejected alternatives

- Spotify Web API: 2026 development-mode changes removed track popularity and artist top tracks,
  restrict playlist-item access, and impose platform attribution/usage obligations. It is no longer
  a reproducible public popularity feed for this importer.
- Last.fm: the API requires a separate key and its published terms describe a limited,
  non-commercial, revocable license. It is viable as a future comparison signal, but adds a
  credential and less favorable operational certainty than the CC0 MetaBrainz pair.
- Billboard chart pages: no approved bulk API/source was established for this feature. Scraping
  chart pages would be brittle and terms-sensitive, so it is not used; the CC0 MusicBrainz series
  representation is used instead.
- ListenBrainz sitewide statistics: legally and technically usable under the documented CC0 terms,
  but the live July 22 sample was heavily concentrated in current BTS-related listening even after
  time-range interleaving. It failed the party-diversity quality stop and remains only a secondary
  comparison signal.
- YouTube search rank: useful only for finding a rendition after canonical song selection. Channel
  and upload metadata are not authoritative song identity or cross-era popularity evidence.

## Corpus policy

Target up to 5,000 songs, but stop below that number whenever identity, coverage, match quality, or
quota is weak. Start with the pinned Rolling Stone 2021 series and available annual Billboard
Year-End Hot 100 subseries. Sort each series by its explicit rank, round-robin across list years,
deduplicate normalized
artist/title, and cap each canonical artist at eight songs in the initial pass. Retain collaboration display credits while normalizing
`featuring`, `feat.`, and `ft.` to a common comparison token. `Various Artists`, missing MBIDs,
missing artist/title, and ambiguous credits stay outside discovery until corrected.

The default market/language focus is US and English-first, not English-only. Prefer recognizable
party material across pop, rock, R&B/soul, hip-hop, country, dance/disco, Latin crossover,
alternative, and standards, with representation across the 1960s through current releases.
MusicBrainz genres and earliest reliable release year are optional enrichment; absence is reported,
not guessed. Apply concentration caps within genre and decade audits. Do not infer explicit-content
status from a title; unknown content remains operator-review metadata, and party-safe filtering is
deferred until a reliable source field exists.

For each canonical song, create a deterministic independent checkpoint and issue one cached YouTube search shaped as `artist title karaoke`, then one
batched video-details lookup: normally 101 quota units. A claim reserves 303 units for bounded
retries. Exact replay and unchanged canonical query/source identity reuse the persisted payload and
spend zero new search quota. At 10,000 daily units, a safe first tranche is at most 25 new songs
(2,525 expected; 7,575 conservatively reserved), followed by a quality audit before expansion.

Accept high-confidence karaoke/backing tracks that are public, processed, embeddable, relevant to
the canonical identity, and not live or an ordinary cover. Only retain `fallback_lyric` or
`fallback_audio` after no suitable karaoke result for an important song; keep it ineligible and
replaceable. Stop a tranche if canonical mismatch, karaoke-brand/uploader leakage, live/cover noise,
weak confidence, fallback rate, missing metadata, or unresolved review backlog exceeds the sample's
operator capacity. Never pad to 5,000.
