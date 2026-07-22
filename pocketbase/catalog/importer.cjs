'use strict'

const CLASSIFICATIONS = ['karaoke', 'original', 'lyric', 'live', 'cover', 'fallback_lyric', 'fallback_audio', 'other', 'unknown']
const REVIEW_STATES = ['unreviewed', 'approved', 'rejected', 'needs_review']

// The importer and PocketBase hook share this boundary: only JSON values cross
// the persistence/protocol edge.  Undefined, non-finite numbers, cyclic values,
// and opaque/native wrappers are rejected instead of being silently coerced.
function normalizeJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('json_value_invalid_number')
    return value
  }
  if (value === undefined) throw new Error('json_value_undefined')
  if (typeof value !== 'object') throw new Error('json_value_invalid_type')
  if (seen.has(value)) throw new Error('json_value_cyclic')
  seen.add(value)
  let result
  if (Array.isArray(value)) result = value.map((entry) => normalizeJsonValue(entry, seen))
  else {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      const raw = typeof value.toString === 'function' ? String(value) : ''
      if (!/^(?:\[|\{|\"|null|true|false|-?\d)/.test(raw)) throw new Error('json_value_wrapper_ambiguous')
      try { result = normalizeJsonValue(JSON.parse(raw), seen) } catch (_) { throw new Error('json_value_wrapper_malformed') }
    } else result = Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJsonValue(value[key], seen)]))
  }
  seen.delete(value)
  return result
}

function canonicalize(value) { return normalizeJsonValue(value) }

function serializeJson(value) { return JSON.stringify(normalizeJsonValue(value)) }

function sourceFingerprint({ query = '', items = [] }) {
  const crypto = require('node:crypto')
  return crypto.createHash('sha256').update(serializeJson({ query, items })).digest('hex')
}

function finalDigest({ source = {}, items = [] }) {
  const crypto = require('node:crypto')
  return crypto.createHash('sha256').update(serializeJson({ source: { url: String(source.url || ''), terms: String(source.terms || ''), retrievedAt: String(source.retrievedAt || '') }, total: items.length, items })).digest('hex')
}

// YouTube's quota resets on America/Los_Angeles time, not at UTC midnight. Keep this
// helper deterministic so callers can supply a fixed instant in tests.
function quotaDayKey(value = new Date()) {
  const instant = value instanceof Date ? value : new Date(value)
  const year = instant.getUTCFullYear()
  const sunday = (month, ordinal) => {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    return 1 + ((7 - first) % 7) + (ordinal - 1) * 7
  }
  const start = Date.UTC(year, 2, sunday(2, 2), 10)
  const end = Date.UTC(year, 10, sunday(10, 1), 9)
  const offset = instant.getTime() >= start && instant.getTime() < end ? -7 : -8
  const pacific = new Date(instant.getTime() + offset * 60 * 60 * 1000)
  return `${pacific.getUTCFullYear()}-${String(pacific.getUTCMonth() + 1).padStart(2, '0')}-${String(pacific.getUTCDate()).padStart(2, '0')}`
}

function classify(video = {}) {
  const text = `${video.title || ''} ${video.description || ''}`.toLowerCase()
  if (/\b(live|concert|performance)\b/.test(text)) return { classification: 'live', confidence: 0.98, reason: 'live_performance' }
  if (/\bkaraoke\b|backing track|instrumental/.test(text)) return { classification: 'karaoke', confidence: /\bkaraoke\b/.test(text) ? 0.92 : 0.75, reason: 'karaoke_backing_signal' }
  if (/\baudio only\b|\bofficial audio\b/.test(text)) return { classification: 'fallback_audio', confidence: 0.86, reason: 'audio_fallback_signal' }
  if (/\blyrics?\b|lyric video/.test(text)) return { classification: 'fallback_lyric', confidence: 0.9, reason: 'lyric_fallback_signal' }
  if (/\bcover\b/.test(text)) return { classification: 'cover', confidence: 0.8, reason: 'cover_signal' }
  if (/\bofficial\b|music video/.test(text)) return { classification: 'original', confidence: 0.85, reason: 'original_signal' }
  return { classification: 'unknown', confidence: 0.25, reason: 'insufficient_metadata' }
}

function normalized(value, max = 240) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, max) }

function normalize(video, batchKey, query = '') {
  if (!video || !/^[A-Za-z0-9_-]{11}$/.test(video.youtubeId || video.id)) throw new Error('invalid_youtube_id')
  const youtubeId = video.youtubeId || video.id
  const classified = classify(video); const classification = classified.classification
  const reviewStatus = REVIEW_STATES.includes(video.reviewStatus) ? video.reviewStatus : 'unreviewed'
  const title = String(video.canonicalTitle || video.title || '').trim().slice(0, 240)
  const artist = String(video.canonicalArtist || video.artist || '').trim().slice(0, 160)
  const identityComplete = Boolean(title && artist)
  return {
    youtube_id: youtubeId,
    title: title || youtubeId,
    artist,
    eligible: identityComplete && classification === 'karaoke' && reviewStatus === 'approved',
    provenance: String(video.provenance || 'youtube_api').slice(0, 120),
    eligibility_reason: identityComplete ? classified.reason : 'missing_canonical_identity',
    source: String(video.source || 'youtube').slice(0, 80),
    source_query: String(query).slice(0, 160),
    classification,
    classification_confidence: classified.confidence,
    review_status: reviewStatus,
    import_batch: String(batchKey).slice(0, 80),
    normalized_title: normalized(title), normalized_artist: normalized(artist, 160),
    metadata_json: {
      videoTitle: video.videoTitle || null,
      channelTitle: video.channelTitle || null,
      channelId: video.channelId || null,
      publishedAt: video.publishedAt || null,
    },
  }
}

function plan(items, { cursor = 0, quotaUsed = 0, quotaLimit = 10000, cost = 100 } = {}) {
  const start = Math.max(0, cursor)
  const remaining = Math.max(0, quotaLimit - quotaUsed)
  const count = Math.min(items.length - start, Math.floor(remaining / cost))
  return { items: items.slice(start, start + count), nextCursor: start + count, quotaUsed: quotaUsed + count * cost, paused: start + count < items.length }
}

function validateChunk({ cursor, offset, existingFingerprint, chunkFingerprint }) {
  if (existingFingerprint) {
    if (existingFingerprint !== chunkFingerprint) throw new Error('chunk_source_mismatch')
    return { replay: true }
  }
  if (offset !== cursor) throw new Error('chunk_out_of_order')
  return { replay: false }
}

const CLAIM_TRANSITIONS = {
  reserved: new Set(['in_progress', 'failed']),
  in_progress: new Set(['ready', 'failed']),
  ready: new Set(['complete', 'ready']),
  complete: new Set(['complete']),
  failed: new Set(['in_progress', 'failed']),
}
function validateClaimTransition(current, next) {
  const from = String(current || 'reserved'); const to = String(next || '')
  if (!CLAIM_TRANSITIONS[from]?.has(to)) throw new Error('claim_transition_invalid')
  return true
}
function validateClaimPayload(payload, expected = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('claim_payload_invalid')
  const normalized = normalizeJsonValue(payload)
  if (!Array.isArray(normalized.items)) throw new Error('claim_payload_items_invalid')
  if (expected.sourceFingerprint && normalized.sourceFingerprint !== expected.sourceFingerprint) throw new Error('claim_source_conflict')
  if (expected.chunkFingerprint && normalized.chunkFingerprint !== expected.chunkFingerprint) throw new Error('claim_chunk_conflict')
  if (expected.digest && normalized.digest !== expected.digest) throw new Error('claim_digest_conflict')
  if (expected.order && JSON.stringify(normalized.order || []) !== JSON.stringify(expected.order)) throw new Error('claim_order_conflict')
  return normalized
}

module.exports = { CLASSIFICATIONS, REVIEW_STATES, classify, normalize, plan, quotaDayKey, sourceFingerprint, finalDigest, normalized, validateChunk, normalizeJsonValue, serializeJson, validateClaimTransition, validateClaimPayload }
