'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { classify, normalize, plan, quotaDayKey, sourceFingerprint, validateChunk } = require('./importer.cjs')

test('quota day follows the America/Los_Angeles boundary across UTC midnight', () => {
  assert.equal(quotaDayKey('2026-07-23T06:59:59.000Z'), '2026-07-22')
  assert.equal(quotaDayKey('2026-07-23T07:00:00.000Z'), '2026-07-23')
  assert.equal(quotaDayKey('2026-01-23T07:59:59.000Z'), '2026-01-22')
  assert.equal(quotaDayKey('2026-01-23T08:00:00.000Z'), '2026-01-23')
})

test('classification is deterministic and excludes non-karaoke videos', () => {
  assert.deepEqual(classify({ title: 'Queen - Bohemian Rhapsody Karaoke Backing Track' }), { classification: 'karaoke', confidence: 0.92, reason: 'karaoke_backing_signal' })
  assert.equal(classify({ title: 'Queen - Bohemian Rhapsody (Official Music Video)' }).classification, 'original')
  assert.equal(classify({ title: 'Song live concert performance' }).classification, 'live')
  assert.equal(classify({ title: 'Song lyric video' }).classification, 'fallback_lyric')
  assert.equal(classify({ title: 'Song official audio only' }).classification, 'fallback_audio')
})

test('normalization is resumable and approval-gated', () => {
  const row = normalize({ id: 'dQw4w9WgXcQ', title: 'Track Karaoke', artist: 'Artist' }, 'batch-1', 'track')
  assert.equal(row.eligible, false)
  assert.equal(row.review_status, 'unreviewed')
  assert.equal(row.import_batch, 'batch-1')
  assert.equal(row.classification, 'karaoke')
  assert.equal(row.classification_confidence, 0.92)
  assert.equal(row.normalized_title, 'track karaoke')
  assert.throws(() => normalize({ id: 'bad' }, 'batch-1'), /invalid_youtube_id/)
})

test('YouTube channel provenance can never populate canonical artist or title', () => {
  const row = normalize({
    id: 'dQw4w9WgXcQ',
    videoTitle: 'Brand Karaoke - A Song',
    channelTitle: 'Brand Karaoke',
    channelId: 'channel-1',
  }, 'batch-1', 'track')
  assert.equal(row.artist, '')
  assert.equal(row.title, 'dQw4w9WgXcQ')
  assert.equal(row.eligible, false)
  assert.equal(row.eligibility_reason, 'missing_canonical_identity')
  assert.deepEqual(row.metadata_json, {
    videoTitle: 'Brand Karaoke - A Song',
    channelTitle: 'Brand Karaoke',
    channelId: 'channel-1',
    publishedAt: null,
  })
})

test('canonical source identity wins over conflicting YouTube uploader metadata', () => {
  const row = normalize({
    id: 'dQw4w9WgXcQ',
    canonicalTitle: 'A Song',
    canonicalArtist: 'Singer feat. Guest',
    title: 'Wrong Parsed Title',
    artist: 'Wrong Parsed Artist',
    channelTitle: 'Brand Karaoke',
  }, 'batch-1')
  assert.equal(row.title, 'A Song')
  assert.equal(row.artist, 'Singer feat. Guest')
  assert.equal(row.normalized_artist, 'singer feat guest')
})

test('quota plan advances cursor without exceeding daily budget', () => {
  const result = plan([1, 2, 3], { cursor: 1, quotaUsed: 9000, quotaLimit: 10000, cost: 100 })
  assert.deepEqual(result.items, [2, 3])
  assert.equal(result.nextCursor, 3)
  assert.equal(result.quotaUsed, 9200)
  assert.equal(result.paused, false)
})

test('source fingerprints are order-stable and detect changed batch input', () => {
  const first = sourceFingerprint({ query: 'queen karaoke', items: [{ id: 'dQw4w9WgXcQ', title: 'Track' }] })
  const same = sourceFingerprint({ items: [{ title: 'Track', id: 'dQw4w9WgXcQ' }], query: 'queen karaoke' })
  const changed = sourceFingerprint({ query: 'queen karaoke', items: [{ id: '9bZkp7q19f0', title: 'Track' }] })
  assert.equal(first, same)
  assert.notEqual(first, changed)
})

test('documented fixture produces a stable full-manifest fingerprint', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'karaoke-manifest.json'), 'utf8'))
  assert.equal(sourceFingerprint(manifest), sourceFingerprint(JSON.parse(JSON.stringify(manifest))))
  assert.equal(manifest.items.length, 3)
})

test('new chunks must be contiguous while exact replay remains resumable', () => {
  assert.deepEqual(validateChunk({ cursor: 100, offset: 100, chunkFingerprint: 'same' }), { replay: false })
  assert.deepEqual(validateChunk({ cursor: 200, offset: 0, existingFingerprint: 'same', chunkFingerprint: 'same' }), { replay: true })
  assert.throws(() => validateChunk({ cursor: 100, offset: 200, chunkFingerprint: 'new' }), /chunk_out_of_order/)
  assert.throws(() => validateChunk({ cursor: 100, offset: 0, existingFingerprint: 'old', chunkFingerprint: 'new' }), /chunk_source_mismatch/)
})
