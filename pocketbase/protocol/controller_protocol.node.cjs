'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { ProtocolStore, sanitizeCommandPayload, sanitizeState } = require('./controller_protocol.cjs')

test('only approved actions and sanitized payloads are accepted', () => {
  assert.deepEqual(sanitizeCommandPayload('open_video', { videoId: 'dQw4w9WgXcQ', ignored: 'x' }), { videoId: 'dQw4w9WgXcQ' })
  assert.deepEqual(sanitizeCommandPayload('seek', { seekSeconds: 1.23456 }), { seekSeconds: 1.235 })
  assert.throws(() => sanitizeCommandPayload('open_video', { videoId: 'short' }), /videoId is invalid/)
  assert.throws(() => sanitizeCommandPayload('play', { loungeToken: 'must-not-persist' }), /does not accept/)
})

test('enrollment grants are single-use and device secrets are not grant data', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant({ ttlMs: 100 })
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  assert.ok(enrolled.deviceSecret)
  assert.equal(store.grants.get(grant.id).tokenHash.includes(grant.token), false)
  assert.throws(() => store.enroll({ token: grant.token, deviceName: 'replay' }), /enrollment_grant_invalid/)
  clock += 1000
  const expired = store.createEnrollmentGrant({ ttlMs: 10 })
  clock += 11
  assert.throws(() => store.enroll({ token: expired.token, deviceName: 'expired' }), /enrollment_grant_invalid/)
})

test('resume keeps the current generation while a new session stales the old one', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant()
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  const first = store.startSession(enrolled.device.id)
  const resumed = store.startSession(enrolled.device.id, first.id)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.id, first.id)
  assert.equal(resumed.generation, first.generation)
  const second = store.startSession(enrolled.device.id)
  assert.equal(second.generation, first.generation + 1)
  assert.throws(() => store.assertSession(enrolled.device.id, first.id, first.generation), /stale_session/)
  assert.doesNotThrow(() => store.assertSession(enrolled.device.id, second.id, second.generation))
})

test('idempotency is durable and conflicting key reuse is rejected', () => {
  const store = new ProtocolStore(() => 1000)
  const grant = store.createEnrollmentGrant()
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  const session = store.startSession(enrolled.device.id)
  const first = store.issueCommand({ deviceId: enrolled.device.id, sessionGeneration: session.generation, action: 'play', payload: {}, idempotencyKey: 'party-001-play' })
  const duplicate = store.issueCommand({ deviceId: enrolled.device.id, sessionGeneration: session.generation, action: 'play', payload: {}, idempotencyKey: 'party-001-play' })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.id, first.id)
  assert.throws(() => store.issueCommand({ deviceId: enrolled.device.id, sessionGeneration: session.generation, action: 'pause', payload: {}, idempotencyKey: 'party-001-play' }), /idempotency_conflict/)
})

test('acknowledgement is terminal and replay-safe; expired commands fail', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant()
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  const session = store.startSession(enrolled.device.id)
  const command = store.issueCommand({ deviceId: enrolled.device.id, sessionGeneration: session.generation, action: 'pause', payload: {}, idempotencyKey: 'party-001-pause', expiresInMs: 10 })
  assert.equal(store.acknowledge({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, commandId: command.id, status: 'succeeded' }).status, 'succeeded')
  assert.equal(store.acknowledge({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, commandId: command.id, status: 'succeeded' }).status, 'succeeded')
  clock += 11
  const expired = store.issueCommand({ deviceId: enrolled.device.id, sessionGeneration: session.generation, action: 'get_now_playing', payload: {}, idempotencyKey: 'party-001-now', expiresInMs: 1 })
  clock += 2
  assert.throws(() => store.acknowledge({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, commandId: expired.id, status: 'succeeded' }), /command_expired/)
})

test('state reports contain only safe playback fields', () => {
  assert.deepEqual(sanitizeState({ connectionState: 'connected', videoId: 'dQw4w9WgXcQ', playerState: 'playing', positionSeconds: 2.3456, durationSeconds: 30, lastCommandSequence: 4, loungeToken: 'redacted' }), {
    connectionState: 'connected', videoId: 'dQw4w9WgXcQ', playerState: 'playing', positionSeconds: 2.346, durationSeconds: 30, lastCommandSequence: 4,
  })
  assert.equal(Object.hasOwn(sanitizeState({ connectionState: 'connected', cookies: 'secret' }), 'cookies'), false)
})
