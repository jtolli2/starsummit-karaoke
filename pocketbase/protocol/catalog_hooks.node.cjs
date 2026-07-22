'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')

test('catalog callbacks resolve their helpers through the reload-safe global contract', () => {
  const replacement = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/:id\/replace'[\s\S]*?\n}\)/)
  assert.ok(replacement)
  assert.match(replacement[0], /require\(__hooks \+ '\/party_queue\.pb\.js'\)/)
  assert.match(replacement[0], /globalThis\.__partyQueue/)
  assert.match(replacement[0], /YOUTUBE_ID/)
})

test('catalog API exposes frontend review and pagination contract', () => {
  assert.match(hook, /totalItems, totalPages/)
  assert.match(hook, /reviewState:/)
  assert.match(hook, /reviewState: str\(song, 'review_status'\) \|\| 'unreviewed'/)
  assert.match(hook, /return c\.json\(200, \{ id: id\(song\), reviewState, eligible:/)
  assert.match(hook, /perPage \+ 1/)
})

test('catalog import uses immutable manifest/chunk metadata and derived classification', () => {
  assert.match(hook, /manifestFingerprint/)
  assert.match(hook, /chunk_source_mismatch/)
  assert.match(hook, /classifyCatalogItem\(item\)/)
  assert.doesNotMatch(hook, /classes\.includes\(item\.classification\)/)
  assert.match(hook, /replacement_unavailable/)
  assert.match(hook, /offset !== num\(batch, 'cursor'\)/)
  assert.match(hook, /chunk_out_of_order/)
  assert.match(hook, /fallback_lyric/)
  assert.match(hook, /fallback_audio/)
})
