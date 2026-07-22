'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')
const repairMigration = fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512300_repair_song_catalog_collection.js'), 'utf8')
const quotaMigration = fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512000_youtube_quota.js'), 'utf8')
const claimsMigration = fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512100_youtube_claims.js'), 'utf8')
const payloadMigration = fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512200_youtube_payloads.js'), 'utf8')

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

test('live catalog discovery stays server-side and records quota/availability metadata', () => {
  assert.match(hook, /YOUTUBE_API_KEY/)
  assert.match(hook, /youtube\/v3\/search\?part=snippet&type=video/)
  assert.match(hook, /youtube\/v3\/videos\?part=snippet,contentDetails,status,statistics/)
  assert.match(hook, /quota_used/)
  assert.match(hook, /requestedMaxResults/)
  assert.match(hook, /chunk_replay/)
  assert.match(hook, /timeout: 15/)
  assert.match(hook, /youtube_quota_exhausted/)
  assert.match(hook, /embeddable === true/)
  assert.doesNotMatch(hook, /return json\(c, 503, 'youtube_import_unavailable'/)
})

test('live claims persist payload and quota day before catalog completion', () => {
  assert.match(hook, /payload_json', \{ items, total, spent \}/)
  assert.match(hook, /set\(claim, 'status', 'ready'\)/)
  assert.match(hook, /set\(claim, 'status', 'complete'\)/)
  assert.match(hook, /quota_day_key/)
  assert.match(hook, /day_key = \{:\s*day\}/)
  assert.match(hook, /set\(chunk, 'payload_json', items\)/)
  assert.match(hook, /America\/Los_Angeles/)
  assert.match(hook, /ownerToken = str\(claim, 'owner_token'\) \|\| ownerToken/)
  assert.match(hook, /!\['ready', 'complete'\]\.includes\(str\(existingClaim, 'status'\)\)/)
  assert.match(hook, /const quotaDay = dayKey\(\)/)
})

test('live fetch failures release the persisted reservation for retry', () => {
  assert.match(hook, /set\(claim, 'status', 'failed'\)/)
  assert.match(hook, /set\(claim, 'reserved_units', 0\)/)
  assert.match(hook, /Math\.max\(0, num\(quota, 'reserved'\) - reserved\)/)
})

test('claim cleanup is owned by the current invocation', () => {
  assert.match(hook, /owner_token/)
  assert.match(hook, /str\(claim, 'owner_token'\) === ownerToken/)
  assert.match(hook, /error\.quotaCost/)
  assert.match(hook, /attemptedCost/)
  assert.match(hook, /globalThis\.__partyQueue \|\| \{\}/)
  assert.match(hook, /globalThis\.__partyQueue = .*youtubeRequest/)
  assert.match(hook, /lease_expires_at/)
  assert.match(hook, /oldReserved.*oldDay/)
  assert.match(hook, /youtube_claim_stale_owner/)
  assert.match(hook, /if \(!items\.length\)/)
  assert.match(hook, /\['ready', 'complete'\]\.includes\(str\(claim, 'status'\)\)/)
})

test('catalog repair preserves records while rebinding stale relation metadata', () => {
  assert.match(repairMigration, /songRelation\.collectionId = songs\.id/)
  assert.match(repairMigration, /app\.save\(queue\)/)
  assert.match(repairMigration, /queue records remain[\s\S]*song ids/)
  assert.match(repairMigration, /importRelation\.collectionId = imports\.id/)
})

test('catalog repair keeps catalog collections private and restores field options', () => {
  assert.match(repairMigration, /const makePrivate = \(collection\)/)
  assert.match(repairMigration, /collection\[key\] !== null/)
  assert.match(repairMigration, /const ensureField = \(collection, name, type, options = \{\}\)/)
  assert.match(repairMigration, /if \(field\.type !== type\) return false/)
  assert.match(repairMigration, /required: false, default: false/)
})

test('YouTube ledger migrations tolerate missing retained collections without record rewrites', () => {
  for (const migration of [quotaMigration, claimsMigration, payloadMigration]) {
    assert.match(migration, /try \{ return app\.findCollectionByNameOrId\(name\) \} catch \(_\) \{ return null \}/)
    assert.match(migration, /const makePrivate = \(collection\)/)
    assert.match(migration, /const ensureField = \(collection, name, type, options = \{\}\)/)
  }
  assert.match(quotaMigration, /idx_karaoke_youtube_quota_day/)
  assert.match(quotaMigration, /historical duplicate[\s\S]*records remain/)
  assert.match(claimsMigration, /idx_karaoke_youtube_claim_key/)
  assert.match(claimsMigration, /status\.type === 'select'/)
  assert.match(payloadMigration, /name: 'karaoke_catalog_imports'/)
  assert.match(payloadMigration, /name: 'karaoke_catalog_import_chunks'/)
  assert.match(payloadMigration, /relation\.collectionId = imports\.id/)
})
