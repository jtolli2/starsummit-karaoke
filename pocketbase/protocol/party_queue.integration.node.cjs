'use strict'

// Focused real-runtime coverage. Run with:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/party_queue.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

test('party lifecycle authorization and expiry on PocketBase 0.39.7', { skip: !process.env.POCKETBASE_BIN }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-party-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir]); execFileSync(bin, ['superuser', 'upsert', 'op@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir])
  const port = 19500 + Math.floor(Math.random() * 200); const server = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' }); t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`; for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch (_) {} await new Promise((r) => setTimeout(r, 100)) }
  const call = async (url, method, payload, token) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); let json = {}; try { json = await r.json() } catch (_) {} return { status: r.status, json } }
  const su = await call('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'op@test.invalid', password: 'CorrectHorseBatteryStaple123!' }); assert.equal(su.status, 200)
  const user = await call('/api/collections/users/records', 'POST', { email: 'tablet@test.invalid', password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin' }, su.json.token); assert.equal(user.status, 200)
  const tablet = await call('/api/collections/users/auth-with-password', 'POST', { identity: 'tablet@test.invalid', password: 'TabletPassword123!' }); assert.equal(tablet.status, 200)
  const created = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); assert.equal(created.status, 201, JSON.stringify(created))
  assert.ok([401, 403].includes((await call('/api/collections/karaoke_queue/records', 'GET')).status))
  assert.equal((await call('/api/karaoke/parties/join', 'POST', { code: 'NOTREAL1' })).status, 410)
  const expired = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); assert.equal(expired.status, 201)
  assert.equal((await call(`/api/collections/karaoke_parties/records/${expired.json.id}`, 'PATCH', { expires_at: new Date(Date.now() - 1000).toISOString() }, su.json.token)).status, 200)
  assert.equal((await call('/api/karaoke/parties/join', 'POST', { code: expired.json.code })).status, 410)
  const joinA = await call('/api/karaoke/parties/join', 'POST', { code: created.json.code }); const joinB = await call('/api/karaoke/parties/join', 'POST', { code: created.json.code }); assert.equal(joinA.status, 201); assert.equal(joinB.status, 201)
  assert.equal((await call('/api/karaoke/parties/queue', 'GET', undefined, joinA.json.credential)).status, 200)
  const songs = await Promise.all(['dQw4w9WgXcQ', '9bZkp7q19f0', 'J---aiyznGQ'].map((youtube_id, i) => call('/api/collections/karaoke_songs/records', 'POST', { youtube_id, title: `Song ${i}`, artist: 'Test', eligible: true }, su.json.token)))
  songs.forEach((s) => assert.equal(s.status, 200, JSON.stringify(s)))
  const ineligible = await call('/api/collections/karaoke_songs/records', 'POST', { youtube_id: 'Zi_XLOBDo_Y', title: 'Unapproved song', artist: 'Test', eligible: false }, su.json.token)
  assert.equal(ineligible.status, 200, JSON.stringify(ineligible))
  const grant = await call('/api/karaoke/controllers/enrollment-grants', 'POST', { ttlMinutes: 5 }, su.json.token); assert.equal(grant.status, 201)
  const enrolled = await call('/api/karaoke/controllers/enroll', 'POST', { token: grant.json.token, deviceName: 'queue tablet' }); assert.equal(enrolled.status, 201)
  assert.equal((await call(`/api/collections/karaoke_parties/records/${created.json.id}`, 'PATCH', { controller_device: enrolled.json.deviceId }, su.json.token)).status, 200)
  const deviceAuth = await call('/api/collections/controller_devices/auth-with-password', 'POST', { identity: enrolled.json.deviceKey, password: enrolled.json.deviceSecret }); assert.equal(deviceAuth.status, 200)
  const deviceToken = deviceAuth.json.token; const session = await call('/api/karaoke/controllers/sessions', 'POST', {}, deviceToken); assert.equal(session.status, 201)
  const reqA = await call('/api/karaoke/requests', 'POST', { credential: joinA.json.credential, youtubeId: 'dQw4w9WgXcQ' }); assert.equal(reqA.status, 201, JSON.stringify(reqA))
  const reqB = await call('/api/karaoke/requests', 'POST', { credential: joinB.json.credential, youtubeId: '9bZkp7q19f0' }); assert.equal(reqB.status, 201, JSON.stringify(reqB))
  assert.equal((await call('/api/karaoke/requests', 'POST', { credential: joinA.json.credential, youtubeId: 'J---aiyznGQ' })).status, 429)
  const next = await call(`/api/karaoke/queue/next?partyId=${created.json.id}`, 'GET', undefined, tablet.json.token); assert.equal(next.status, 200); assert.equal(next.json.queue.id, reqA.json.id)
  assert.equal((await call('/api/karaoke/queue/transition', 'POST', { queueId: reqB.json.id, from: 'queued', to: 'playing' }, tablet.json.token)).json.error, 'not_next')
  const started = await call('/api/karaoke/queue/transition', 'POST', { queueId: reqA.json.id, from: 'queued', to: 'playing' }, tablet.json.token); assert.equal(started.status, 200)
  const commands = await call(`/api/karaoke/controllers/commands?sessionId=${session.json.id}&generation=${session.json.generation}&after=0`, 'GET', undefined, deviceToken); assert.equal(commands.status, 200); assert.ok(commands.json.commands.some((c) => c.idempotencyKey === `queue-start-${reqA.json.id}`))
  assert.equal((await call('/api/karaoke/queue/transition', 'POST', { queueId: reqA.json.id, from: 'queued', to: 'playing' }, tablet.json.token)).json.idempotent, true)
  const joinC = await call('/api/karaoke/parties/join', 'POST', { code: created.json.code }); const joinD = await call('/api/karaoke/parties/join', 'POST', { code: created.json.code }); assert.equal(joinC.status, 201); assert.equal(joinD.status, 201)
  const race = await Promise.all([
    call('/api/karaoke/requests', 'POST', { credential: joinC.json.credential, youtubeId: 'J---aiyznGQ' }),
    call('/api/karaoke/requests', 'POST', { credential: joinD.json.credential, youtubeId: 'J---aiyznGQ' }),
  ])
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409])
})

test('guest realtime wake is party-scoped and payload-free on PocketBase 0.39.7', { skip: !process.env.POCKETBASE_BIN }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-party-wake-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir]); execFileSync(bin, ['superuser', 'upsert', 'wake@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir])
  const port = 19700 + Math.floor(Math.random() * 200); const server = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' }); t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch (_) {} await new Promise((r) => setTimeout(r, 100)) }
  const call = async (url, method, payload, token) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); let json = {}; try { json = await r.json() } catch (_) {} return { status: r.status, json } }
  const connect = async (credential) => {
    const abort = new AbortController(); const response = await fetch(`${base}/api/realtime`, { headers: { authorization: `Bearer ${credential}` }, signal: abort.signal }); assert.equal(response.status, 200)
    const reader = response.body.getReader(); let text = ''
    for (let i = 0; i < 20; i++) { const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ done: true }), 500))]); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); const clientId = /"clientId"\s*:\s*"([^"]+)"/.exec(text)?.[1]; if (clientId) return { reader, abort, clientId } }
    throw new Error(`missing PB_CONNECT: ${text}`)
  }
  const subscribe = (clientId, credential, subscriptions) => call('/api/realtime', 'POST', { clientId, subscriptions }, credential)
  const readWake = async (reader, timeout = 3000) => {
    let text = ''; const deadline = Date.now() + timeout
    while (Date.now() < deadline) { const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ done: true }), 250))]); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); const frame = text.split(/\r?\n\r?\n/).find((item) => item.includes('karaoke_party_wake')); if (frame) return frame }
    return null
  }
  const su = await call('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'wake@test.invalid', password: 'CorrectHorseBatteryStaple123!' }); assert.equal(su.status, 200)
  const user = await call('/api/collections/users/records', 'POST', { email: 'wake-tablet@test.invalid', password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin' }, su.json.token); assert.equal(user.status, 200)
  const tablet = await call('/api/collections/users/auth-with-password', 'POST', { identity: 'wake-tablet@test.invalid', password: 'TabletPassword123!' }); assert.equal(tablet.status, 200)
  const partyA = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); const partyB = await call('/api/karaoke/parties', 'POST', {}, tablet.json.token); assert.equal(partyA.status, 201); assert.equal(partyB.status, 201)
  const guestA = await call('/api/karaoke/parties/join', 'POST', { code: partyA.json.code }); const guestB = await call('/api/karaoke/parties/join', 'POST', { code: partyB.json.code }); assert.equal(guestA.status, 201); assert.equal(guestB.status, 201)
  const song = await call('/api/collections/karaoke_songs/records', 'POST', { youtube_id: 'dQw4w9WgXcQ', title: 'Wake song', artist: 'Test', eligible: true }, su.json.token); assert.equal(song.status, 200)

  const invalid = await connect('not-a-guest-credential'); const invalidResult = await subscribe(invalid.clientId, 'not-a-guest-credential', ['karaoke_party_wake']); assert.equal(invalidResult.status, 403); invalid.abort.abort()
  const unsupported = await connect(guestA.json.credential); const unsupportedResult = await subscribe(unsupported.clientId, guestA.json.credential, ['karaoke_party_wake', 'karaoke_queue/*']); assert.equal(unsupportedResult.status, 403); unsupported.abort.abort()
  const streamA = await connect(guestA.json.credential); const streamB = await connect(guestB.json.credential)
  assert.ok([200, 204].includes((await subscribe(streamA.clientId, guestA.json.credential, ['karaoke_party_wake'])).status))
  assert.ok([200, 204].includes((await subscribe(streamB.clientId, guestB.json.credential, ['karaoke_party_wake'])).status))
  const request = await call('/api/karaoke/requests', 'POST', { youtubeId: 'dQw4w9WgXcQ' }, guestA.json.credential); assert.equal(request.status, 201, JSON.stringify(request))
  const wakeA = await readWake(streamA.reader); assert.ok(wakeA, 'same-party subscriber should receive wake')
  assert.match(wakeA, /"name"\s*:\s*"karaoke_party_wake"/); assert.match(wakeA, /"data"\s*:\s*"\{\}"/)
  assert.equal(await readWake(streamB.reader, 1200), null, 'different-party subscriber must not receive wake')
  streamA.abort.abort(); streamB.abort.abort()
})
