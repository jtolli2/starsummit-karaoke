'use strict'

// Conservative, deterministic identity matching. This module is deliberately
// independent of YouTube: callers provide the title and a MusicBrainz query
// function, allowing the hook to enforce the server-only network boundary.
const MB_ROOT = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'StarsummitKaraoke/1.0 (https://github.com/jtolli2/starsummit-karaoke)'

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 240)
}

function parseYouTubeTitle(raw) {
  const original = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!original) return { status: 'deferred', reason: 'malformed_title' }
  const bad = /\b(live|concert|medley|mashup|remix|sped\s*up|slowed|nightcore|acoustic|instrumental|cover)\b/i
  if (bad.test(original)) return { status: 'deferred', reason: /medley|mashup/i.test(original) ? 'medley' : /live|concert/i.test(original) ? 'live' : /remix|sped|slowed|nightcore/i.test(original) ? 'remix_or_version' : 'cover' }
  let title = original.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(/\b(official\s+)?(?:music\s+)?video\b/ig, ' ')
  title = title.replace(/\b(?:lyrics?|lyric\s+video|karaoke|hd|hq|4k|audio\s+only)\b/ig, ' ').replace(/\s+/g, ' ').trim()
  let artist = ''; const separators = [' - ', ' – ', ' — ', ' | ']
  for (const separator of separators) { const index = title.indexOf(separator); if (index > 0) { artist = title.slice(0, index).trim(); title = title.slice(index + separator.length).trim(); break } }
  if (!artist || !title || artist.length > 160 || title.length > 240) return { status: 'deferred', reason: 'malformed_title' }
  if (/\b(?:official|records?|channel|karaoke)\b/i.test(artist)) return { status: 'deferred', reason: 'weak_artist_parse' }
  const featured = artist.match(/^(.*?)\s+(?:feat\.?|featuring|ft\.?)\s+(.*)$/i)
  const aliases = featured ? [featured[1].trim(), featured[2].trim()] : []
  return { status: 'parsed', artist, title, aliases, normalizedArtist: normalize(artist), normalizedTitle: normalize(title) }
}

function artistNames(recording) {
  const names = []
  for (const credit of recording?.['artist-credit'] || []) {
    if (credit?.artist?.name) names.push(String(credit.artist.name))
    for (const alias of credit?.artist?.aliases || []) if (alias?.name) names.push(String(alias.name))
  }
  if (recording?.['artist-credit-phrase']) names.push(String(recording['artist-credit-phrase']))
  return [...new Set(names.map(normalize).filter(Boolean))]
}

function releases(recording) {
  return (recording?.releases || []).map((release) => ({ id: String(release.id || ''), title: String(release.title || ''), date: String(release.date || ''), evidence: Boolean(release.id || release.title) })).filter((release) => release.evidence)
}

function fullArtistCredit(recording) {
  return String(recording?.['artist-credit-phrase'] || '').trim() || (recording?.['artist-credit'] || []).map((credit) => String(credit?.name || credit?.artist?.name || '')).filter(Boolean).join(' feat ')
}

function scoreCandidate(parsed, recording) {
  const title = normalize(recording?.title)
  const artists = artistNames(recording)
  const orderedCredit = (recording?.['artist-credit'] || []).map((credit) => normalize(credit?.name || credit?.artist?.name || '')).filter(Boolean).join(' feat ')
  const phrase = normalize(recording?.['artist-credit-phrase'] || '')
  const titleExact = title && title === parsed.normalizedTitle
  const artistExact = phrase === parsed.normalizedArtist || orderedCredit === parsed.normalizedArtist || artists.includes(parsed.normalizedArtist)
  const score = (titleExact ? 0.52 : 0) + (artistExact ? 0.42 : 0) + (recording?.id ? 0.04 : 0)
  return { score, titleExact, artistExact, normalizedTitle: title, normalizedArtists: artists }
}

function evaluateCandidates(parsed, recordings, options = {}) {
  if (parsed.status !== 'parsed') return { decision: 'deferred', reason: parsed.reason, candidates: [] }
  const ranked = recordings.map((recording) => ({ recording, ...scoreCandidate(parsed, recording) }))
    .sort((a, b) => b.score - a.score || String(a.recording.id).localeCompare(String(b.recording.id)))
  const best = ranked[0]
  if (!best || !best.recording?.id) return { decision: 'deferred', reason: 'no_results', candidates: ranked }
  if (!best.titleExact || !best.artistExact) return { decision: 'deferred', reason: 'weak_match', candidates: ranked.slice(0, 2) }
  const strong = ranked.filter((candidate) => candidate.titleExact && candidate.artistExact && candidate.recording?.id)
  const groups = new Map()
  for (const candidate of strong) {
    const artist = fullArtistCredit(candidate.recording)
    if (!artist) continue
    const key = `${normalize(artist)}|${candidate.normalizedTitle}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(candidate)
  }
  const consensus = [...groups.entries()].map(([key, candidates]) => ({ key, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length || b.candidates[0].score - a.candidates[0].score || a.key.localeCompare(b.key))[0]
  if (!consensus) return { decision: 'deferred', reason: 'missing_full_artist_credit', candidates: ranked.slice(0, 2) }
  if (consensus.candidates.length <= strong.length / 2) return { decision: 'deferred', reason: 'identity_no_majority', candidates: ranked.slice(0, 3) }
  const representative = consensus.candidates[0]
  const artist = fullArtistCredit(representative.recording)
  const recordingIds = consensus.candidates.map((candidate) => String(candidate.recording.id))
  const dissenting = ranked.find((candidate) => !consensus.candidates.includes(candidate))
  const releaseEvidence = consensus.candidates.flatMap((candidate) => releases(candidate.recording))
    .filter((release, index, all) => index === all.findIndex((other) => other.id === release.id && other.title === release.title))
  const reason = consensus.candidates.length > 1 ? 'majority_identity_consensus' : 'high_confidence_exact'
  return {
    decision: 'matched',
    reason,
    confidence: representative.score,
    identityKey: consensus.key,
    recording: {
      id: recordingIds.length === 1 ? recordingIds[0] : '',
      title: String(representative.recording.title),
      artist,
      aliases: [...new Set(consensus.candidates.flatMap((candidate) => artistNames(candidate.recording)))],
      releases: releaseEvidence,
    },
    consensus: { agreeing: consensus.candidates.length, considered: strong.length, share: consensus.candidates.length / strong.length, recordingIds },
    runnerUp: dissenting ? { id: String(dissenting.recording.id || ''), score: dissenting.score, separation: representative.score - dissenting.score } : null,
    candidates: ranked.slice(0, Math.max(3, consensus.candidates.length)),
  }
}

function createMatcher({ fetchJson, cache, clock = () => Date.now(), minIntervalMs = 1000, userAgent = USER_AGENT } = {}) {
  if (typeof fetchJson !== 'function') throw new Error('musicbrainz_fetch_required')
  const durable = cache || { get: () => null, set: () => {} }
  return async function match(videoTitle, options = {}) {
    const parsed = parseYouTubeTitle(videoTitle); if (parsed.status !== 'parsed') return { parsed, decision: 'deferred', reason: parsed.reason }
    const query = `recording:"${parsed.title}" AND artist:"${parsed.artist}"`
    const cacheKey = `mb:recording:${normalize(query)}`; const cached = await durable.get(cacheKey)
    let payload = cached
    if (!payload) {
      const nextAllowed = Number(await durable.get('mb:next_allowed_at') || 0); const wait = Math.max(0, nextAllowed - clock()); if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      payload = await fetchJson(`${MB_ROOT}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=10`, { Accept: 'application/json', 'User-Agent': userAgent })
      await durable.set(cacheKey, payload); await durable.set('mb:next_allowed_at', clock() + minIntervalMs)
    }
    const recordings = Array.isArray(payload?.recordings) ? payload.recordings : []
    const result = evaluateCandidates(parsed, recordings, options)
    return { parsed, query, cacheHit: Boolean(cached), ...result }
  }
}

module.exports = { MB_ROOT, USER_AGENT, normalize, parseYouTubeTitle, evaluateCandidates, createMatcher, releases }
