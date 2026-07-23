'use strict'

const crypto = require('node:crypto')

const COMMAND_ACTIONS = Object.freeze(['open_video', 'play', 'pause', 'seek', 'get_now_playing'])
const TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed'])
const MAX_PAYLOAD_BYTES = 4096
const MAX_STATE_BYTES = 4096

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value)
}

function isVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value)
}

function payloadError(message, field = 'payload') {
  const error = new Error(message)
  error.code = 'invalid_payload'
  error.field = field
  return error
}

function sanitizeCommandPayload(action, payload) {
  if (!COMMAND_ACTIONS.includes(action)) throw payloadError('Unsupported command action', 'action')
  if (!isPlainObject(payload)) throw payloadError('Payload must be an object')

  let sanitized
  switch (action) {
    case 'open_video':
      if (!isVideoId(payload.videoId)) throw payloadError('videoId is invalid', 'videoId')
      sanitized = { videoId: payload.videoId }
      break
    case 'seek':
      if (typeof payload.seekSeconds !== 'number' || !Number.isFinite(payload.seekSeconds) || payload.seekSeconds < 0 || payload.seekSeconds > 86400) {
        throw payloadError('seekSeconds must be a number from 0 to 86400', 'seekSeconds')
      }
      sanitized = { seekSeconds: Math.round(payload.seekSeconds * 1000) / 1000 }
      break
    case 'play':
    case 'pause':
    case 'get_now_playing':
      if (Object.keys(payload).length > 0) throw payloadError('This action does not accept payload fields')
      sanitized = {}
      break
    default:
      throw payloadError('Unsupported command action', 'action')
  }

  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw payloadError('Payload is too large')
  }
  return sanitized
}

function sanitizeState(input) {
  if (!isPlainObject(input)) throw payloadError('State must be an object', 'state')
  const state = {}
  if (typeof input.connectionState === 'string') {
    if (!['connected', 'connecting', 'disconnected', 'error'].includes(input.connectionState)) {
      throw payloadError('connectionState is invalid', 'connectionState')
    }
    state.connectionState = input.connectionState
  } else {
    throw payloadError('connectionState is required', 'connectionState')
  }
  if (input.videoId !== undefined && input.videoId !== null) {
    if (!isVideoId(input.videoId)) throw payloadError('videoId is invalid', 'videoId')
    state.videoId = input.videoId
  } else {
    state.videoId = null
  }
  if (input.playerState !== undefined) {
    if (!['playing', 'paused', 'buffering', 'ended', 'unstarted', 'unknown'].includes(input.playerState)) {
      throw payloadError('playerState is invalid', 'playerState')
    }
    state.playerState = input.playerState
  } else {
    state.playerState = 'unknown'
  }
  for (const key of ['positionSeconds', 'durationSeconds']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 86400) {
        throw payloadError(`${key} is invalid`, key)
      }
      state[key] = Math.round(input[key] * 1000) / 1000
    } else {
      state[key] = null
    }
  }
  if (input.lastCommandSequence !== undefined) {
    if (!isFiniteInteger(input.lastCommandSequence) || input.lastCommandSequence < 0) {
      throw payloadError('lastCommandSequence is invalid', 'lastCommandSequence')
    }
    state.lastCommandSequence = input.lastCommandSequence
  } else {
    state.lastCommandSequence = 0
  }
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
    throw payloadError('State is too large')
  }
  return state
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

class ProtocolStore {
  constructor(now = () => Date.now()) {
    this.now = now
    this.grants = new Map()
    this.devices = new Map()
    this.sessions = new Map()
    this.commands = new Map()
    this.states = new Map()
    this.sequence = new Map()
  }

  createEnrollmentGrant({ ttlMs = 15 * 60 * 1000, createdBy = 'operator' } = {}) {
    const token = randomSecret(24)
    const id = randomSecret(12)
    this.grants.set(id, { id, tokenHash: hashSecret(token), expiresAt: this.now() + ttlMs, usedAt: null, createdBy })
    return { id, token, expiresAt: this.grants.get(id).expiresAt }
  }

  enroll({ token, deviceName }) {
    if (typeof token !== 'string' || token.length < 16 || typeof deviceName !== 'string' || !deviceName.trim()) {
      throw new Error('invalid enrollment request')
    }
    const grant = [...this.grants.values()].find((candidate) => candidate.tokenHash === hashSecret(token))
    if (!grant || grant.usedAt || grant.expiresAt <= this.now()) throw new Error('enrollment_grant_invalid')
    const deviceKey = `device_${randomSecret(18)}`
    const deviceSecret = randomSecret(32)
    const device = { id: randomSecret(12), deviceKey, secretHash: hashSecret(deviceSecret), deviceName, revoked: false, lastSeenAt: null }
    this.devices.set(device.id, device)
    grant.usedAt = this.now()
    return { device: clone(device), deviceKey, deviceSecret }
  }

  startSession(deviceId, resumeSessionId) {
    const device = this.devices.get(deviceId)
    if (!device || device.revoked) throw new Error('device_forbidden')
    let previous = resumeSessionId ? this.sessions.get(resumeSessionId) : null
    if (previous && (previous.deviceId !== deviceId || previous.expiresAt <= this.now())) previous = null
    const currentGeneration = this.sequence.get(`generation:${deviceId}`) || 0
    if (previous && previous.generation === currentGeneration) {
      previous.expiresAt = this.now() + 15 * 60 * 1000
      device.lastSeenAt = this.now()
      return { ...previous, resumed: true }
    }
    const generation = currentGeneration + 1
    this.sequence.set(`generation:${deviceId}`, generation)
    device.lastSeenAt = this.now()
    for (const command of this.commands.values()) {
      if (command.deviceId === deviceId && command.sessionGeneration < generation && command.status === 'pending') {
        command.status = 'failed'
        command.errorCode = 'stale_session'
      }
    }
    const session = { id: randomSecret(12), deviceId, generation, expiresAt: this.now() + 15 * 60 * 1000, previousId: previous?.id || null }
    this.sessions.set(session.id, session)
    return { ...session, resumed: Boolean(previous) }
  }

  assertSession(deviceId, sessionId, generation) {
    const session = this.sessions.get(sessionId)
    if (!session || session.deviceId !== deviceId || session.expiresAt <= this.now()) throw new Error('session_expired')
    const current = this.sequence.get(`generation:${deviceId}`)
    if (session.generation !== generation || current !== generation) throw new Error('stale_session')
    return session
  }

  reportState({ deviceId, sessionId, generation }) {
    this.assertSession(deviceId, sessionId, generation)
    const device = this.devices.get(deviceId)
    device.lastSeenAt = this.now()
    return clone(device)
  }

  issueCommand({ deviceId, sessionGeneration, action, payload, idempotencyKey, expiresInMs = 30000 }) {
    if (!Number.isInteger(sessionGeneration) || sessionGeneration < 1) throw new Error('device_session_required')
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new Error('invalid_idempotency_key')
    const sanitized = sanitizeCommandPayload(action, payload)
    const existing = [...this.commands.values()].find((command) => command.deviceId === deviceId && command.idempotencyKey === idempotencyKey)
    if (existing) {
      if (existing.action !== action || JSON.stringify(existing.payload) !== JSON.stringify(sanitized)) throw new Error('idempotency_conflict')
      return { ...existing, duplicate: true }
    }
    const sequence = (this.sequence.get(`command:${deviceId}`) || 0) + 1
    this.sequence.set(`command:${deviceId}`, sequence)
    const command = { id: randomSecret(12), deviceId, sessionGeneration, sequence, idempotencyKey, action, payload: sanitized, expiresAt: this.now() + expiresInMs, status: 'pending', errorCode: null }
    this.commands.set(command.id, command)
    return clone(command)
  }

  acknowledge({ deviceId, sessionId, generation, commandId, status, errorCode = null }) {
    this.assertSession(deviceId, sessionId, generation)
    if (!TERMINAL_STATUSES.includes(status)) throw new Error('invalid_ack_status')
    const command = this.commands.get(commandId)
    if (!command || command.deviceId !== deviceId || command.sessionGeneration !== generation) throw new Error('command_forbidden')
    if (command.status !== 'pending') {
      if (command.status === status) return clone(command)
      throw new Error('command_already_terminal')
    }
    if (command.expiresAt <= this.now()) {
      command.status = 'failed'
      command.errorCode = 'expired'
      throw new Error('command_expired')
    }
    command.status = status
    command.errorCode = status === 'failed' ? (errorCode || 'device_error') : null
    command.ackedAt = this.now()
    return clone(command)
  }
}

module.exports = {
  COMMAND_ACTIONS,
  TERMINAL_STATUSES,
  MAX_PAYLOAD_BYTES,
  MAX_STATE_BYTES,
  sanitizeCommandPayload,
  sanitizeState,
  hashSecret,
  randomSecret,
  ProtocolStore,
}
