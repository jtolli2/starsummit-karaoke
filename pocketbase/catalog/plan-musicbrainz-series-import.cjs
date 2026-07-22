#!/usr/bin/env node
'use strict'

const { API_ROOT, DEFAULT_SERIES, SOURCE_TERMS, digest, recordingFromSeries, selectCorpus } = require('./musicbrainz-series-source.cjs')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2); return [key, value] }))
const limit = Math.min(5000, Math.max(1, Number(args.limit || 25)))
const perArtist = Math.min(25, Math.max(1, Number(args['per-artist'] || 8)))
const retrievedAt = new Date().toISOString()
const userAgent = 'StarsummitKaraoke/1.0 (https://github.com/jtolli2/starsummit-karaoke)'
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let lastRequestAt = 0

async function get(path) {
  const delay = Math.max(0, 1050 - (Date.now() - lastRequestAt)); if (delay) await wait(delay)
  const response = await fetch(`${API_ROOT}${path}`, { headers: { accept: 'application/json', 'user-agent': userAgent } }); lastRequestAt = Date.now()
  if (!response.ok) throw new Error(`musicbrainz_http_${response.status}`)
  return response.json()
}

async function recordingSeries() {
  const out = []
  for (const source of DEFAULT_SERIES) {
    const payload = await get(`/series/${source.id}?inc=${source.kind === 'series' ? 'series-rels' : 'recording-rels'}&fmt=json`)
    if (source.kind === 'recordings') out.push({ id: source.id, name: source.name, relations: payload.relations || [] })
    else for (const relation of payload.relations || []) if (relation.series?.id) out.push({ id: relation.series.id, name: relation.series.name, relations: null })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

async function main() {
  const series = await recordingSeries(); const candidates = []
  for (const entry of series) if (!entry.relations) entry.relations = ((await get(`/series/${entry.id}?inc=recording-rels&fmt=json`)).relations || []).slice().sort((a, b) => Number(a['ordering-key'] || 0) - Number(b['ordering-key'] || 0))
  let rankIndex = 0
  while (selectCorpus(candidates, { limit, perArtist }).length < limit) {
    let progressed = false
    for (const entry of series) {
      const relation = entry.relations?.[rankIndex]
      if (!relation) continue
      progressed = true
      if (!relation.recording?.id) continue
      const recording = await get(`/recording/${relation.recording.id}?inc=artist-credits+genres+releases&fmt=json`)
      candidates.push(recordingFromSeries(relation, recording, entry))
      if (selectCorpus(candidates, { limit, perArtist }).length >= limit) break
    }
    if (!progressed) break
    rankIndex++
  }
  const items = selectCorpus(candidates, { limit, perArtist })
  const manifest = { source: { url: `${API_ROOT}/series`, terms: SOURCE_TERMS, retrievedAt, series: DEFAULT_SERIES }, policy: { market: 'US', languageFocus: 'English-first', perArtist, requestedLimit: limit, qualityStop: 'ordered series rank and verified canonical identity only; no padding' }, items }
  manifest.manifestFingerprint = digest(manifest)
  manifest.quotaPlan = { searches: items.length, expectedUnits: items.length * 101, conservativeReservedUnits: items.length * 303 }
  manifest.discoveryRequests = items.map((item, index) => ({
    batchKey: `mb-series-${manifest.manifestFingerprint.slice(0, 12)}-${String(index).padStart(4, '0')}`,
    manifestFingerprint: manifest.manifestFingerprint,
    fetchFromYoutube: true,
    query: `${item.canonicalArtist} ${item.canonicalTitle} karaoke`,
    canonical: { title: item.canonicalTitle, artist: item.canonicalArtist, source: item.source, sourceId: item.sourceId, sourceList: item.sourceList, sourceRank: item.sourceRank, sourcePopularity: item.sourcePopularity, genres: item.genres, releaseYear: item.releaseYear },
    source: manifest.source,
    offset: 0,
    total: 10,
    requestedMaxResults: 10,
  }))
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
