'use strict'

// Run against a real PocketBase binary with:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/controller_protocol.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const binary = process.env.POCKETBASE_BIN

test('PocketBase controller protocol authorization and transitions', { skip: !binary }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data')
  execFileSync(binary, ['migrate', 'up', '--dir', dataDir], { stdio: 'ignore' })
  execFileSync(binary, ['superuser', 'upsert', 'operator@example.test', 'CorrectHorseBatteryStaple123!', '--dir', dataDir], { stdio: 'ignore' })
  const port = 19000 + Math.floor(Math.random() * 500)
  const server = spawn(binary, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' })
  t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const call = async (url, method, body, token) => {
    const response = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    let json = {}
    try { json = await response.json() } catch (_) {}
    return { status: response.status, json }
  }
  const readSseRecord = async (predicate, reader) => {
    let text = ''
    for (let i = 0; i < 30; i++) {
      const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ done: true }), 500))])
      if (chunk.done) break
      text += new TextDecoder().decode(chunk.value)
      const data = text.match(/data:(\{.*\})/g)?.map((line) => line.slice(5)).find((line) => {
        try { return predicate(JSON.parse(line)) } catch (_) { return false }
      })
      if (data) return JSON.parse(data)
    }
    throw new Error(`missing realtime record event: ${text}`)
  }
  const superAuth = await call('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'operator@example.test', password: 'CorrectHorseBatteryStaple123!' })
  assert.equal(superAuth.status, 200)
  const superToken = superAuth.json.token
  assert.equal((await call('/api/karaoke/controllers/enrollment-grants', 'POST', { ttlMinutes: 5 })).status, 403)
  const grant = await call('/api/karaoke/controllers/enrollment-grants', 'POST', { ttlMinutes: 5 }, superToken)
  assert.equal(grant.status, 201)
  const enrolled = await call('/api/karaoke/controllers/enroll', 'POST', { token: grant.json.token, deviceName: 'integration tablet' })
  assert.equal(enrolled.status, 201)
  assert.equal((await call('/api/karaoke/controllers/enroll', 'POST', { token: grant.json.token, deviceName: 'replay' })).status, 410)
  const deviceAuth = await call('/api/collections/controller_devices/auth-with-password', 'POST', { identity: enrolled.json.deviceKey, password: enrolled.json.deviceSecret })
  assert.equal(deviceAuth.status, 200)
  const deviceToken = deviceAuth.json.token
  const session = await call('/api/karaoke/controllers/sessions', 'POST', {}, deviceToken)
  assert.equal(session.status, 201)
  const resumed = await call('/api/karaoke/controllers/sessions', 'POST', { resumeSessionId: session.json.id }, deviceToken)
  assert.deepEqual([resumed.status, resumed.json.id, resumed.json.generation], [201, session.json.id, session.json.generation])
  const user = await call('/api/collections/users/records', 'POST', { email: 'tablet@example.test', password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin' }, superToken)
  assert.equal(user.status, 200)
  const tabletAuth = await call('/api/collections/users/auth-with-password', 'POST', { identity: 'tablet@example.test', password: 'TabletPassword123!' })
  assert.equal(tabletAuth.status, 200)
  const tabletToken = tabletAuth.json.token
  assert.equal((await call('/api/karaoke/controllers/enrollment-grants', 'POST', { ttlMinutes: 5 }, tabletToken)).status, 403)
  const commandBody = { deviceId: enrolled.json.deviceId, action: 'open_video', payload: { videoId: 'dQw4w9WgXcQ' }, idempotencyKey: 'integration-open-001' }
  const command = await call('/api/karaoke/controller-commands', 'POST', commandBody, tabletToken)
  assert.equal(command.status, 201)
  assert.equal((await call('/api/karaoke/controller-commands', 'POST', commandBody, tabletToken)).status, 200)
  assert.equal((await call('/api/karaoke/controller-commands', 'POST', { ...commandBody, action: 'pause', payload: {} }, tabletToken)).status, 409)
  assert.equal((await call('/api/karaoke/controller-commands', 'POST', commandBody, deviceToken)).status, 403)
  assert.ok([400, 403].includes((await call('/api/collections/controller_commands/records', 'POST', { device: enrolled.json.deviceId }, deviceToken)).status))
  const query = `/api/karaoke/controllers/commands?sessionId=${session.json.id}&generation=${session.json.generation}&after=999`
  const fetched = await call(query, 'GET', undefined, deviceToken)
  assert.equal(fetched.status, 200, JSON.stringify(fetched))
  assert.equal(fetched.json.commands[0].id, command.json.id)
  const streamAbort = new AbortController()
  const stream = await fetch(`${base}/api/realtime`, { headers: { authorization: `Bearer ${deviceToken}` }, signal: streamAbort.signal })
  assert.equal(stream.status, 200)
  const reader = stream.body.getReader()
  let sseText = ''
  for (let i = 0; i < 10 && !sseText.includes('PB_CONNECT'); i++) {
    const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ done: true }), 500))])
    if (chunk.done) break
    sseText += new TextDecoder().decode(chunk.value)
  }
  const clientId = /"clientId"\s*:\s*"([^"]+)"/.exec(sseText)?.[1]
  assert.ok(clientId, `missing PB_CONNECT in SSE: ${sseText}`)
  const subscription = await call('/api/realtime', 'POST', { clientId, subscriptions: ['controller_commands/*'] }, deviceToken)
  assert.ok([200, 204].includes(subscription.status), JSON.stringify(subscription))
  const sseCommand = await call('/api/karaoke/controller-commands', 'POST', { ...commandBody, idempotencyKey: 'integration-sse-001' }, tabletToken)
  assert.equal(sseCommand.status, 201)
  const createEvent = await readSseRecord((data) => data.action === 'create' && data.record?.id === sseCommand.json.id, reader)
  assert.equal(createEvent.record.id, sseCommand.json.id)
  const sseFetch = await call(query, 'GET', undefined, deviceToken)
  assert.equal(sseFetch.status, 200)
  assert.ok(sseFetch.json.commands.some((item) => item.id === sseCommand.json.id))
  const sseAckBody = { sessionId: session.json.id, generation: session.json.generation, status: 'succeeded' }
  assert.equal((await call(`/api/karaoke/controllers/commands/${sseCommand.json.id}/ack`, 'POST', sseAckBody, deviceToken)).status, 200)
  const updateEvent = await readSseRecord((data) => data.action === 'update' && data.record?.id === sseCommand.json.id, reader)
  assert.equal(updateEvent.record.id, sseCommand.json.id)
  streamAbort.abort()
  const ackBody = { sessionId: session.json.id, generation: session.json.generation, status: 'succeeded' }
  const ack = await call(`/api/karaoke/controllers/commands/${command.json.id}/ack`, 'POST', ackBody, deviceToken)
  assert.equal(ack.status, 200, JSON.stringify(ack))
  assert.equal((await call(`/api/karaoke/controllers/commands/${command.json.id}/ack`, 'POST', ackBody, deviceToken)).status, 200)
  assert.equal((await call(`/api/karaoke/controllers/commands/${command.json.id}/ack`, 'POST', { ...ackBody, status: 'failed' }, deviceToken)).status, 409)
  const raceCommand = await call('/api/karaoke/controller-commands', 'POST', { ...commandBody, idempotencyKey: 'integration-race-001' }, tabletToken)
  assert.equal(raceCommand.status, 201)
  const raceAcks = await Promise.all(['succeeded', 'failed'].map((status) => call(`/api/karaoke/controllers/commands/${raceCommand.json.id}/ack`, 'POST', { ...ackBody, status }, deviceToken)))
  assert.deepEqual(raceAcks.map((response) => response.status).sort(), [200, 409])
  const state = { sessionId: session.json.id, generation: session.json.generation, connectionState: 'connected', videoId: 'dQw4w9WgXcQ', playerState: 'playing', positionSeconds: 1.25, durationSeconds: 10, lastCommandSequence: 1 }
  const stateResponse = await call('/api/karaoke/controllers/state', 'PUT', state, deviceToken)
  assert.equal(stateResponse.status, 200, JSON.stringify(stateResponse))
  const next = await call('/api/karaoke/controllers/sessions', 'POST', {}, deviceToken)
  assert.equal(next.json.generation, session.json.generation + 1)
  assert.equal((await call(query, 'GET', undefined, deviceToken)).status, 409)
  assert.equal((await call('/api/karaoke/controllers/state', 'PUT', state, deviceToken)).status, 409)
  assert.equal((await call(`/api/karaoke/controllers/commands/${command.json.id}/ack`, 'POST', ackBody, deviceToken)).status, 409)
})
