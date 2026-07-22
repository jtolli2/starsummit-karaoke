'use strict'

const crypto = require('node:crypto')

const API_ROOT = 'https://musicbrainz.org/ws/2'
const SOURCE_TERMS = 'MusicBrainz core data CC0; ordered recording-series relationships snapshot'
const DEFAULT_SERIES = [
  { id: '355b26c9-001e-4728-852e-82b4379adb82', name: 'Rolling Stone: 500 Greatest Songs of All Time: 2021 edition', kind: 'recordings' },
  { id: '283ee2f5-49fd-4df3-a5f9-d40b6f554876', name: 'Billboard Year-End Hot 100 singles', kind: 'series' },
]

function normalized(value, max = 240) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ').replace(/[^a-z0-9]+/g, ' ')
    .trim().slice(0, max)
}

function recordingFromSeries(relation, recording, series) {
  const credits = Array.isArray(recording?.['artist-credit']) ? recording['artist-credit'] : []
  const artist = credits.map((credit) => `${credit?.name || credit?.artist?.name || ''}${credit?.joinphrase || ''}`).join('').trim()
  const title = String(recording?.title || relation?.recording?.title || '').trim()
  const sourceId = String(recording?.id || relation?.recording?.id || '').trim()
  const rank = Number(relation?.['ordering-key'] || relation?.['attribute-values']?.number || 0)
  const uncertain = !artist || !title || !sourceId || !rank || /^various artists$/i.test(artist)
  const releaseYears = (Array.isArray(recording?.releases) ? recording.releases : [])
    .filter((release) => !release?.status || release.status === 'Official')
    .map((release) => Number(String(release?.date || '').match(/^(\d{4})/)?.[1] || 0))
    .filter((year) => year >= 1800 && year <= new Date().getUTCFullYear() + 1)
  return {
    canonicalArtist: artist,
    canonicalTitle: title,
    normalizedArtist: normalized(artist, 160),
    normalizedTitle: normalized(title),
    source: 'musicbrainz_series',
    sourceId,
    sourceList: String(series.name || '').slice(0, 120),
    sourceListId: String(series.id || ''),
    sourceRank: rank,
    sourcePopularity: Math.max(0, 1001 - rank),
    genres: Array.isArray(recording?.genres) ? recording.genres.map((genre) => genre.name).filter(Boolean) : [],
    releaseYear: releaseYears.length ? Math.min(...releaseYears) : 0,
    identityStatus: uncertain ? 'uncertain' : 'verified_source',
    identityReason: uncertain ? 'missing_or_ambiguous_musicbrainz_series_identity' : 'musicbrainz_ordered_series_identity',
  }
}

function selectCorpus(items, { limit = 5000, perArtist = 8 } = {}) {
  const seen = new Set(); const artistCounts = new Map(); const selected = []
  for (const item of items) {
    const identity = `${item.normalizedArtist}|${item.normalizedTitle}`
    const artistCount = artistCounts.get(item.normalizedArtist) || 0
    if (item.identityStatus !== 'verified_source' || seen.has(identity) || artistCount >= perArtist) continue
    seen.add(identity); artistCounts.set(item.normalizedArtist, artistCount + 1); selected.push(item)
    if (selected.length >= limit) break
  }
  return selected
}

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }

module.exports = { API_ROOT, DEFAULT_SERIES, SOURCE_TERMS, digest, normalized, recordingFromSeries, selectCorpus }
