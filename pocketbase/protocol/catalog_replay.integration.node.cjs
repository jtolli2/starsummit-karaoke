'use strict'

// Focused retained-runtime proof.  Run with:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/catalog_replay.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const crypto = require('node:crypto')

test('PocketBase 0.39.7 preserves replay payloads and quarantines malformed legacy claims', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-replay-pb-'))
  const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  fs.writeFileSync(path.join(migrations, '1784512990_seed_claims.js'), `migrate((app) => {
    const imports = new Collection({ name: 'karaoke_catalog_imports', type: 'base', fields: [
      { name: 'batch_key', type: 'text' }, { name: 'source_fingerprint', type: 'text' },
    ] }); app.save(imports)
    const batch = new Record(imports); batch.set('batch_key', 'batch'); batch.set('source_fingerprint', '${'a'.repeat(64)}'); app.save(batch)
    const collection = new Collection({ name: 'karaoke_youtube_claims', type: 'base', fields: [
      { name: 'batch_key', type: 'text' }, { name: 'claim_key', type: 'text' }, { name: 'status', type: 'text' },
      { name: 'payload_json', type: 'json' }, { name: 'spent_units', type: 'number' },
      { name: 'reserved_units', type: 'number' }, { name: 'error_code', type: 'text' },
      { name: 'lifecycle_version', type: 'number' }, { name: 'lifecycle_reason', type: 'text' },
      { name: 'audit_json', type: 'json' },
      { name: 'marker', type: 'text' },
    ] })
    app.save(collection)
    const ready = new Record(collection); ready.set('batch_key', 'batch'); ready.set('claim_key', 'batch:${'b'.repeat(64)}'); ready.set('status', 'ready')
    ready.set('payload_json', JSON.stringify({ items: [{ id: 'dQw4w9WgXcQ' }], total: 1, spent: 101 }))
    ready.set('spent_units', 101); ready.set('reserved_units', 0); ready.set('marker', 'replay-me'); app.save(ready)
    const malformed = new Record(collection); malformed.set('batch_key', 'batch'); malformed.set('claim_key', 'batch:bad'); malformed.set('status', 'complete')
    malformed.set('payload_json', '{not-json'); malformed.set('spent_units', 101); malformed.set('reserved_units', 0); malformed.set('marker', 'quarantine-me'); app.save(malformed)
    const wrapper = new Record(collection); wrapper.set('batch_key', 'batch'); wrapper.set('claim_key', 'batch:${'c'.repeat(64)}'); wrapper.set('status', 'failed')
    wrapper.set('payload_json', { items: [{ id: '9bZkp7q19f0' }], total: 1, spent: 101 }); wrapper.set('spent_units', 101); wrapper.set('reserved_units', 0)
    wrapper.set('error_code', 'legacy_payload_quarantined'); wrapper.set('audit_json', [{ action: 'legacy_payload_quarantined', from: 'ready' }]); wrapper.set('marker', 'wrapper-me'); app.save(wrapper)
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784513000_claim_audit_fields.js'), path.join(migrations, '1784513000_claim_audit_fields.js'))
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784513100_repair_catalog_claim_lifecycle.js'), path.join(migrations, '1784513100_repair_catalog_claim_lifecycle.js'))
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784513200_repair_catalog_claim_json_wrappers.js'), path.join(migrations, '1784513200_repair_catalog_claim_json_wrappers.js'))
  fs.writeFileSync(path.join(migrations, '1784513210_assert_claim_repair.js'), `migrate((app) => {
    const rows = app.findRecordsByFilter('karaoke_youtube_claims', '', '+id', 100, 0)
    const replay = rows.find((row) => row.get('marker') === 'replay-me')
    const quarantined = rows.find((row) => row.get('marker') === 'quarantine-me')
    const wrapper = rows.find((row) => row.get('marker') === 'wrapper-me')
    if (!replay || replay.get('status') !== 'ready' || replay.get('spent_units') !== 101) throw new Error('replay claim changed')
    const payload = replay.get('payload_json'); if (typeof payload === 'string') JSON.parse(payload)
    if (!quarantined || quarantined.get('status') !== 'failed' || quarantined.get('error_code') !== 'legacy_payload_quarantined') throw new Error('legacy claim not quarantined')
    const audit = quarantined.get('audit_json'); if (!Array.isArray(audit) || audit[audit.length - 1].action !== 'legacy_payload_quarantined') throw new Error('quarantine audit missing')
    if (!wrapper || wrapper.get('status') !== 'ready' || wrapper.get('error_code') !== '' || wrapper.get('lifecycle_reason') !== 'legacy_wrapper_repaired') throw new Error('wrapper claim not repaired')
  }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  assert.ok(true)
})

test('real hook replays a ready claim across restart and rejects conflicts without quota changes', { skip: !process.env.POCKETBASE_BIN }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-replay-route-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['superuser', 'upsert', 'replay@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir], { stdio: 'pipe' })
  const port = 19900 + Math.floor(Math.random() * 80)
  let serverOutput = ''
  const start = () => {
    const child = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, YOUTUBE_API_KEY: 'fixture-key' } })
    child.stdout.on('data', (chunk) => { serverOutput += chunk })
    child.stderr.on('data', (chunk) => { serverOutput += chunk })
    return child
  }
  let server = start(); t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`
  const waitReady = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return } catch (_) {} await new Promise((r) => setTimeout(r, 100)) }; throw new Error('PocketBase did not start') }
  await waitReady()
  const call = async (url, method, payload, token) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); let json = {}; try { json = await r.json() } catch (_) {}; return { status: r.status, json } }
  const su = await call('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'replay@test.invalid', password: 'CorrectHorseBatteryStaple123!' }); assert.equal(su.status, 200)
  const tabletUser = await call('/api/collections/users/records', 'POST', { email: 'replay-tablet@test.invalid', password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin' }, su.json.token); assert.equal(tabletUser.status, 200)
  const tablet = await call('/api/collections/users/auth-with-password', 'POST', { identity: 'replay-tablet@test.invalid', password: 'TabletPassword123!' }); assert.equal(tablet.status, 200)
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const source = { url: 'https://source.invalid/manifest', terms: 'integration', retrievedAt: '2026-07-22T12:00:00Z' }
  const manifestFingerprint = 'a'.repeat(64); const batchKey = 'replay-route-batch'; const canonical = { title: 'Replay Song', artist: 'Replay Artist', source: 'musicbrainz', sourceId: 'mbid-1' }
  const payload = { items: [{ id: 'dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', title: 'Replay Song Karaoke', canonicalTitle: canonical.title, canonicalArtist: canonical.artist, videoTitle: 'Replay Song Karaoke', channelTitle: 'Fixture Channel', channelId: 'fixture' }], total: 1, spent: 0 }
  const batch = await call('/api/collections/karaoke_catalog_imports/records', 'POST', { batch_key: batchKey, source_fingerprint: manifestFingerprint, source_url: source.url, source_terms: source.terms, source_retrieved_at: source.retrievedAt, status: 'running', quota_limit: 10000, quota_used: 0, cursor: 0, total: 1 }, su.json.token); assert.equal(batch.status, 200, JSON.stringify(batch))
  const quota = await call('/api/collections/karaoke_youtube_quota/records', 'POST', { day_key: dayKey, quota_limit: 10000, reserved: 0, spent: 0 }, su.json.token); assert.equal(quota.status, 200, JSON.stringify(quota))
  const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonicalize({ batchKey, manifestFingerprint, query: 'Replay Song', canonical, requestedMaxResults: 1, offset: 0 }))).digest('hex')
  const orderedIdentity = payload.items.map((item) => item.youtubeId)
  const payloadDigest = crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
  const replayPayload = { ...payload, sourceFingerprint: manifestFingerprint, chunkFingerprint: fingerprint, payloadDigest, orderedIdentity }
  const claim = await call('/api/collections/karaoke_youtube_claims/records', 'POST', { claim_key: `${batchKey}:${fingerprint}`, batch_key: batchKey, status: 'ready', quota_day_key: dayKey, reserved_units: 0, spent_units: 0, payload_json: replayPayload, owner_token: 'fixture-owner', lease_expires_at: new Date(Date.now() + 60000).toISOString(), error_code: '', source_fingerprint: manifestFingerprint, chunk_fingerprint: fingerprint, payload_digest: payloadDigest, ordered_identity_json: orderedIdentity }, su.json.token); assert.equal(claim.status, 200, JSON.stringify(claim))
  const request = { fetchFromYoutube: true, batchKey, manifestFingerprint, query: 'Replay Song', canonical, requestedMaxResults: 1, offset: 0, total: 1, source, items: [] }
  const first = await call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token); assert.equal(first.status, 200, `${JSON.stringify(first)}\n${serverOutput}`); assert.equal(first.json.imported, 1)
  const quotaAfter = await call(`/api/collections/karaoke_youtube_quota/records/${quota.json.id}`, 'GET', undefined, su.json.token); assert.equal(quotaAfter.json.reserved, 0); assert.equal(quotaAfter.json.spent, 0)
  assert.equal((await call(`/api/collections/karaoke_youtube_claims/records/${claim.json.id}`, 'PATCH', { payload_digest: 'c'.repeat(64) }, su.json.token)).status, 200)
  const claimConflict = await call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token); assert.equal(claimConflict.status, 409)
  assert.equal((await call(`/api/collections/karaoke_youtube_claims/records/${claim.json.id}`, 'PATCH', { payload_digest: payloadDigest, status: 'complete' }, su.json.token)).status, 200)
  const chunks = await call(`/api/collections/karaoke_catalog_import_chunks/records?filter=import%3D%22${batch.json.id}%22`, 'GET', undefined, su.json.token); assert.equal(chunks.status, 200)
  const chunk = chunks.json.items[0]; assert.ok(chunk)
  assert.equal((await call(`/api/collections/karaoke_catalog_import_chunks/records/${chunk.id}`, 'PATCH', { chunk_fingerprint: 'b'.repeat(64) }, su.json.token)).status, 200)
  const conflict = await call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token); assert.equal(conflict.status, 409)
  assert.equal((await call(`/api/collections/karaoke_catalog_import_chunks/records/${chunk.id}`, 'PATCH', { chunk_fingerprint: fingerprint }, su.json.token)).status, 200)
  const reorder = await call('/api/karaoke/tablet/catalog/import', 'POST', { ...request, offset: 1 }, tablet.json.token); assert.equal(reorder.status, 422)
  const parallel = await Promise.all([call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token), call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token)]); assert.ok(parallel.every((result) => result.status === 200 && result.json.replay === true), JSON.stringify(parallel))
  server.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 150)); server = start(); await waitReady()
  const replayAfterRestart = await call('/api/karaoke/tablet/catalog/import', 'POST', request, tablet.json.token); assert.equal(replayAfterRestart.status, 200); assert.equal(replayAfterRestart.json.replay, true)
})

test('PocketBase 0.39.7 restores only the exact retained canary identity', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-canary-repair-pb-')); const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  const ids = ['KCI3qN_c3k0', 'NQ7k19pDRIw', 'iEr_Y8DKx84', 'wBz3sceWu9g', 'h0n-mYqB9WQ', '4G-YQA_bsOU', 'WrcwRt6J32o', 'eX9GAhjI2ak', '9gG9hMPvT58']
  fs.writeFileSync(path.join(migrations, '1784513290_seed_canary.js'), `migrate((app) => {
    const imports = new Collection({ name: 'karaoke_catalog_imports', type: 'base', fields: [{ name: 'batch_key', type: 'text' }, { name: 'source_fingerprint', type: 'text' }] }); app.save(imports)
    const batch = new Record(imports); batch.set('batch_key', 'mb-series-b2f47574d772-0000'); batch.set('source_fingerprint', 'b2f47574d7727bb143be393691928bbb20a5a54dc1f3824748785ad205ff3993'); app.save(batch)
    const claims = new Collection({ name: 'karaoke_youtube_claims', type: 'base', fields: [
      { name: 'claim_key', type: 'text' }, { name: 'batch_key', type: 'text' }, { name: 'status', type: 'text' }, { name: 'error_code', type: 'text' },
      { name: 'spent_units', type: 'number' }, { name: 'reserved_units', type: 'number' }, { name: 'payload_json', type: 'json' },
      { name: 'source_fingerprint', type: 'text' }, { name: 'chunk_fingerprint', type: 'text' }, { name: 'payload_digest', type: 'text' },
      { name: 'ordered_identity_json', type: 'json' }, { name: 'audit_json', type: 'json' }, { name: 'lifecycle_reason', type: 'text' },
    ] }); app.save(claims)
    const make = (id, order, marker) => { const claim = new Record(claims); claim.set('id', id); claim.set('claim_key', 'mb-series-b2f47574d772-0000:62161f11f34dc9d2688413e0b14c41c42902165eb1fac98ae658635089529d9b'); claim.set('batch_key', 'mb-series-b2f47574d772-0000'); claim.set('status', 'failed'); claim.set('error_code', 'legacy_payload_quarantined'); claim.set('spent_units', 101); claim.set('reserved_units', 0); claim.set('payload_json', { items: order.map((youtubeId) => ({ youtubeId })), total: 9, spent: 101 }); claim.set('lifecycle_reason', marker); app.save(claim) }
    make('dy36tlhzi17ew1p', ${JSON.stringify(ids)}, 'exact'); make('variantclaim001', ${JSON.stringify([...ids].reverse())}, 'variant')
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784513300_repair_retained_catalog_canary.js'), path.join(migrations, '1784513300_repair_retained_catalog_canary.js'))
  fs.writeFileSync(path.join(migrations, '1784513310_assert_canary.js'), `migrate((app) => { const exact = app.findRecordById('karaoke_youtube_claims', 'dy36tlhzi17ew1p'); const variant = app.findRecordById('karaoke_youtube_claims', 'variantclaim001'); if (exact.get('status') !== 'ready' || exact.get('lifecycle_reason') !== 'retained_canary_repaired') throw new Error('exact canary not repaired'); if (variant.get('status') !== 'failed') throw new Error('variant was repaired') }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); execFileSync(process.env.POCKETBASE_BIN, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' }); assert.ok(true)
})
