'use strict'

// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/fallback_request.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

test('PocketBase 0.39.7 persists a claimed fallback song with catalog defaults and queues it idempotently', { skip: !process.env.POCKETBASE_BIN }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-fallback-request-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir]); execFileSync(bin, ['superuser', 'upsert', 'fallback@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir])
  const port = 19900 + Math.floor(Math.random() * 100); const server = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' }); t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`; for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch (_) {} await new Promise((r) => setTimeout(r, 100)) }
  const call = async (url, method, payload, token) => { const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); let json = {}; try { json = await response.json() } catch (_) {} return { status: response.status, json } }
  const su = await call('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'fallback@test.invalid', password: 'CorrectHorseBatteryStaple123!' }); assert.equal(su.status, 200)
  const user = await call('/api/collections/users/records', 'POST', { email: 'fallback-tablet@test.invalid', password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin' }, su.json.token); assert.equal(user.status, 200)
  const tablet = await call('/api/collections/users/auth-with-password', 'POST', { identity: 'fallback-tablet@test.invalid', password: 'TabletPassword123!' }); assert.equal(tablet.status, 200)
  const party = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); assert.equal(party.status, 201)
  const guest = await call('/api/karaoke/parties/join', 'POST', { code: party.json.code }); assert.equal(guest.status, 201)
  const claim = await call('/api/collections/karaoke_youtube_search_claims/records', 'POST', { query_hash: 'a'.repeat(64), policy_version: 'v2', status: 'ready', payload_json: [{ youtubeId: 'dQw4w9WgXcQ', title: 'Fallback karaoke', channelTitle: 'Test channel', channelId: 'channel', classification: 'karaoke', confidence: 0.91, reason: 'karaoke_signal' }], expires_at: new Date(Date.now() + 3600000).toISOString() }, su.json.token); assert.equal(claim.status, 200, JSON.stringify(claim))
  const guests = await call(`/api/collections/karaoke_guest_identities/records?filter=${encodeURIComponent(`party = "${party.json.id}"`)}`, 'GET', undefined, su.json.token); assert.equal(guests.status, 200); assert.equal(guests.json.items.length, 1)
  const grant = await call('/api/collections/karaoke_youtube_search_access/records', 'POST', { party: party.json.id, guest: guests.json.items[0].id, claim: claim.json.id, expires_at: new Date(Date.now() + 3600000).toISOString() }, su.json.token); assert.equal(grant.status, 200, JSON.stringify(grant))
  const first = await call('/api/karaoke/parties/songs/fallback/request', 'POST', { youtubeId: 'dQw4w9WgXcQ', idempotencyKey: 'fallback-integration-1' }, guest.json.credential); assert.equal(first.status, 201, JSON.stringify({ first, claim: claim.json, grant: grant.json }))
  const song = await call(`/api/collections/karaoke_songs/records?filter=${encodeURIComponent('youtube_id = "dQw4w9WgXcQ"')}`, 'GET', undefined, su.json.token); assert.equal(song.status, 200); assert.equal(song.json.items.length, 1); assert.equal(song.json.items[0].mb_match_status, 'not_attempted')
  const queued = await call(`/api/collections/karaoke_queue/records?filter=${encodeURIComponent(`id = "${first.json.id}"`)}`, 'GET', undefined, su.json.token); assert.equal(queued.status, 200); assert.equal(queued.json.items[0].request_key, 'fallback-integration-1'); assert.equal(queued.json.items[0].requester, guests.json.items[0].id)
  const replay = await call('/api/karaoke/parties/songs/fallback/request', 'POST', { youtubeId: 'dQw4w9WgXcQ', idempotencyKey: 'fallback-integration-1' }, guest.json.credential); assert.equal(replay.status, 200, JSON.stringify({ first, replay })); assert.equal(replay.json.id, first.json.id)
  const samePartyGuest = await call('/api/karaoke/parties/join', 'POST', { code: party.json.code }); assert.equal(samePartyGuest.status, 201)
  const samePartyRejected = await call('/api/karaoke/parties/songs/fallback/request', 'POST', { youtubeId: 'dQw4w9WgXcQ', idempotencyKey: 'fallback-integration-1' }, samePartyGuest.json.credential); assert.equal(samePartyRejected.status, 422); assert.equal(samePartyRejected.json.error, 'fallback_candidate_unavailable')
  const otherParty = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); const otherGuest = await call('/api/karaoke/parties/join', 'POST', { code: otherParty.json.code }); assert.equal(otherGuest.status, 201)
  const rejected = await call('/api/karaoke/parties/songs/fallback/request', 'POST', { youtubeId: 'dQw4w9WgXcQ', idempotencyKey: 'fallback-integration-other-party' }, otherGuest.json.credential); assert.equal(rejected.status, 422); assert.equal(rejected.json.error, 'fallback_candidate_unavailable')
})
