'use strict'

const crypto = require('node:crypto')

const SOURCE_URL = 'https://api.listenbrainz.org/1/stats/sitewide/recordings'
const SOURCE_TERMS = 'ListenBrainz public listen data CC0; canonical recording identity resolved by MusicBrainz core data CC0'

function normalized(value, max = 240) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ').replace(/[^a-z0-9]+/g, ' ')
    .trim().slice(0, max)
}

function canonicalRecording(row, list, rank) {
  const artist = String(row.artist_name || '').trim()
  const title = String(row.track_name || '').trim()
  const sourceId = String(row.recording_mbid || '').trim()
  const uncertain = !artist || !title || !sourceId || /^various artists$/i.test(artist)
  return {
    canonicalArtist: artist,
    canonicalTitle: title,
    normalizedArtist: normalized(artist, 160),
    normalizedTitle: normalized(title),
    source: 'listenbrainz',
    sourceId,
    sourceList: list,
    sourceRank: rank,
    sourcePopularity: Number(row.listen_count || 0),
    identityStatus: uncertain ? 'uncertain' : 'verified_source',
    identityReason: uncertain ? 'missing_or_ambiguous_listenbrainz_identity' : 'listenbrainz_musicbrainz_identity',
  }
}

function selectCorpus(lists, { limit = 5000, perArtist = 8 } = {}) {
  const seen = new Set(); const artistCounts = new Map(); const selected = []
  const names = Object.keys(lists).sort()
  let index = 0
  while (selected.length < limit) {
    let progressed = false
    for (const list of names) {
      const row = lists[list][index]
      if (!row) continue
      progressed = true
      const item = canonicalRecording(row, list, index + 1)
      const identity = `${item.normalizedArtist}|${item.normalizedTitle}`
      const artistCount = artistCounts.get(item.normalizedArtist) || 0
      if (item.identityStatus !== 'verified_source' || seen.has(identity) || artistCount >= perArtist) continue
      seen.add(identity); artistCounts.set(item.normalizedArtist, artistCount + 1); selected.push(item)
      if (selected.length >= limit) break
    }
    if (!progressed) break
    index++
  }
  return selected
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

module.exports = { SOURCE_TERMS, SOURCE_URL, canonicalRecording, digest, normalized, selectCorpus }
