'use strict'

const CLASSIFICATIONS = ['karaoke', 'original', 'lyric', 'live', 'cover', 'fallback_lyric', 'fallback_audio', 'other', 'unknown']
const REVIEW_STATES = ['unreviewed', 'approved', 'rejected', 'needs_review']

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function sourceFingerprint({ query = '', items = [] }) {
  const crypto = require('node:crypto')
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize({ query, items }))).digest('hex')
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
  return {
    youtube_id: youtubeId,
    title: String(video.title || '').trim().slice(0, 240) || youtubeId,
    artist: String(video.artist || video.channelTitle || '').trim().slice(0, 160),
    eligible: classification === 'karaoke' && reviewStatus === 'approved',
    provenance: String(video.provenance || 'youtube_api').slice(0, 120),
    eligibility_reason: classified.reason,
    source: String(video.source || 'youtube').slice(0, 80),
    source_query: String(query).slice(0, 160),
    classification,
    classification_confidence: classified.confidence,
    review_status: reviewStatus,
    import_batch: String(batchKey).slice(0, 80),
    normalized_title: normalized(video.title), normalized_artist: normalized(video.artist || video.channelTitle, 160),
    metadata_json: { channelTitle: video.channelTitle || null, publishedAt: video.publishedAt || null },
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

module.exports = { CLASSIFICATIONS, REVIEW_STATES, classify, normalize, plan, sourceFingerprint, normalized, validateChunk }
