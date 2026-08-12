'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'controller_protocol.pb.js'), 'utf8')
const {
  CONTROLLER_STATE_TTL,
  ProtocolStore,
  canonicalHost,
  freshObservedAt,
  hostMatches,
  normalizeShortCode,
  sanitizeCommandPayload,
  sanitizeState,
  validHost,
} = require('./controller_protocol.cjs')

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
  assert.throws(() => store.enroll({ token: grant.token, deviceName: 'replay' }), /enrollment_grant_replayed/)
  clock += 1000
  const expired = store.createEnrollmentGrant({ ttlMs: 10 })
  clock += 11
  assert.throws(() => store.enroll({ token: expired.token, deviceName: 'expired' }), /enrollment_grant_expired/)
})

test('short code is one-time bearer equivalent and only its hash is retained', () => {
  const store = new ProtocolStore(() => 1000)
  const grant = store.createEnrollmentGrant()
  assert.match(grant.shortCode, /^[A-Z2-9]{16}$/)
  // Manual entry is normalized at the protocol boundary, so a human can use
  // lowercase text, grouping separators, and surrounding whitespace for the
  // same one-time grant.
  const grouped = grant.shortCode.match(/.{4}/g).join('-').toLowerCase()
  assert.equal(normalizeShortCode(` ${grouped} `), grant.shortCode)
  const enrolled = store.enroll({ shortCode: `  ${grouped}  `, deviceName: 'short-code tablet' })
  assert.equal(enrolled.device.deviceName, 'short-code tablet')
  assert.equal(store.grants.get(grant.id).shortCodeHash.includes(grant.shortCode), false)
  assert.throws(() => store.enroll({ shortCode: grant.shortCode, deviceName: 'replay' }), /enrollment_grant_replayed/)
})

test('host canonicalization accepts equivalent case and ports but rejects request-host spoofing', () => {
  assert.equal(validHost(' [2001:db8::1]:443 '), true)
  assert.equal(canonicalHost(' KARAOKE.TEST. '), 'karaoke.test')
  assert.equal(hostMatches('karaoke.test:443', 'KARAOKE.TEST'), true)
  assert.equal(hostMatches('evil.test', 'karaoke.test'), false)
  const at = 1_000_000
  assert.equal(freshObservedAt(new Date(at - CONTROLLER_STATE_TTL).toISOString(), at), true)
  assert.equal(freshObservedAt(new Date(at - CONTROLLER_STATE_TTL - 1).toISOString(), at), false)

  const store = new ProtocolStore(() => 1000)
  const grant = store.createEnrollmentGrant({ expectedServerHost: 'karaoke.test', destination: 'controller' })
  assert.throws(
    () => store.enroll({ token: grant.token, deviceName: 'spoofed', requestHost: 'evil.test', serverHost: 'karaoke.test', destination: 'controller' }),
    /enrollment_grant_wrong_server/,
  )
  const enrolled = store.enroll({ token: grant.token, deviceName: 'trusted', requestHost: ' KARAOKE.TEST:443 ', serverHost: 'karaoke.test', destination: 'controller' })
  assert.equal(enrolled.device.deviceName, 'trusted')
})

test('public host forwarding is accepted only from the fixed private PocketBase upstream', () => {
  assert.match(hook, /X-Starsummit-Public-Host/)
  assert.match(hook, /upstream === 'starsummit-pocketbase-internal:8090'/)
  assert.doesNotMatch(hook, /X-Forwarded-Host/)
})

test('grant status stays pending until a current connected state heartbeat', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant({ createdBy: 'tablet-1' })
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })

  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'pending')
  const session = store.startSession(enrolled.device.id)
  const sessionOnly = store.enrollmentGrantStatus(grant.id, 'tablet-1')
  assert.equal(sessionOnly.state, 'pending')
  assert.equal(sessionOnly.sessionActive, true)
  assert.equal(Object.hasOwn(sessionOnly, 'session'), false)

  store.reportState({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, connectionState: 'connected' })
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'connected')

  // Exactly 90 seconds is still within the advertised freshness window.
  clock += 90_000
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'connected')
  clock += 1
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'pending')
  clock += 15 * 60 * 1000
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'pending', 'expired session must not imply connected')
})

test('grant status reports actionable pending or revoked states for invalid liveness', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant({ createdBy: 'tablet-1' })
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  const session = store.startSession(enrolled.device.id)

  store.reportState({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, connectionState: 'connecting' })
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'pending')
  store.reportState({ deviceId: enrolled.device.id, sessionId: session.id, generation: session.generation, connectionState: 'connected' })
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'connected')

  const newer = store.startSession(enrolled.device.id)
  assert.equal(newer.generation, session.generation + 1)
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'pending', 'old-generation state must not imply connected')

  enrolled.device.revoked = true
  store.devices.get(enrolled.device.id).revoked = true
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').state, 'revoked')
  assert.throws(() => store.enrollmentGrantStatus(grant.id, 'other-operator'), /enrollment_grant_not_found/)
})

test('enrollment grants are host-bound, operator-scoped, revocable, and only one is active', () => {
  const store = new ProtocolStore(() => 1000)
  const grant = store.createEnrollmentGrant({ createdBy: 'tablet-1', expectedServerHost: 'karaoke.test', destination: 'tablet-1' })
  assert.throws(() => store.createEnrollmentGrant({ createdBy: 'tablet-1', expectedServerHost: 'karaoke.test', destination: 'tablet-1' }), /enrollment_grant_active/)
  assert.throws(() => store.enroll({ token: grant.token, deviceName: 'wrong', serverHost: 'evil.test', destination: 'tablet-1' }), /enrollment_grant_wrong_server/)
  const enrolled = store.enroll({ token: grant.token, deviceName: 'normalized', serverHost: ' KARAOKE.TEST ', destination: ' TABLET-1 ' })
  assert.equal(enrolled.device.deviceName, 'normalized')
  assert.equal(store.enrollmentGrantStatus(grant.id).status, 'pending')
  store.revokeEnrollmentGrant(grant.id, 'tablet-1')
  assert.equal(store.enrollmentGrantStatus(grant.id, 'tablet-1').status, 'pending')
  const revocable = store.createEnrollmentGrant({ createdBy: 'tablet-1', expectedServerHost: 'karaoke.test', destination: 'tablet-1' })
  store.revokeEnrollmentGrant(revocable.id, 'tablet-1')
  assert.equal(store.enrollmentGrantStatus(revocable.id, 'tablet-1').status, 'revoked')
  assert.throws(() => store.enroll({ token: revocable.token, deviceName: 'revoked', serverHost: 'karaoke.test', destination: 'tablet-1' }), /enrollment_grant_revoked/)
  assert.throws(() => store.revokeEnrollmentGrant(grant.id, 'other'), /enrollment_grant_not_found/)
})

test('revoke versus redemption has one terminal outcome and never rewrites used_at', () => {
  const store = new ProtocolStore(() => 1000)
  const grant = store.createEnrollmentGrant({ createdBy: 'tablet-1', expectedServerHost: 'karaoke.test', destination: 'tablet-1' })
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet', serverHost: 'karaoke.test', destination: 'tablet-1' })
  const usedAt = store.grants.get(grant.id).usedAt
  const status = store.revokeEnrollmentGrant(grant.id, 'tablet-1')
  assert.equal(status.status, 'pending')
  assert.equal(store.grants.get(grant.id).usedAt, usedAt)
  assert.equal(store.grants.get(grant.id).redeemedDeviceId, enrolled.device.id)
})

test('resume keeps the current generation while a new session stales the old one', () => {
  let clock = 1000
  const store = new ProtocolStore(() => clock)
  const grant = store.createEnrollmentGrant()
  const enrolled = store.enroll({ token: grant.token, deviceName: 'tablet' })
  const first = store.startSession(enrolled.device.id)
  assert.equal(store.devices.get(enrolled.device.id).lastSeenAt, 1000)
  clock += 91_000
  store.reportState({ deviceId: enrolled.device.id, sessionId: first.id, generation: first.generation })
  assert.equal(store.devices.get(enrolled.device.id).lastSeenAt, 92_000)
  clock += 91_000
  const resumed = store.startSession(enrolled.device.id, first.id)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.id, first.id)
  assert.equal(resumed.generation, first.generation)
  assert.equal(store.devices.get(enrolled.device.id).lastSeenAt, 183_000)
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
