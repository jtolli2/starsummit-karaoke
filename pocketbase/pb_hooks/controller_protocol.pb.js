// Native controller protocol for PocketBase 0.39.x.
// All writes to protocol collections are performed here; collection rules lock direct writes.

const ACTIONS = ['open_video', 'play', 'pause', 'seek', 'get_now_playing']
const TERMINAL = ['succeeded', 'failed']
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function requestInfo(c) {
  try {
    if (c && typeof c.requestInfo === 'function') return c.requestInfo() || {}
    return $apis.requestInfo(c) || {}
  } catch (_) { return {} }
}

function requestData(c) {
  const info = requestInfo(c)
  if (info.body && typeof info.body === 'object') return info.body
  if (info.data && typeof info.data === 'object') return info.data
  return {}
}

function authRecord(c) { return requestInfo(c).auth || null }
function query(c, key) { const value = requestInfo(c).query?.[key]; return Array.isArray(value) ? value[0] : value }

function jsonError(c, status, code, message) {
  return c.json(status, { error: code, message })
}

function now() { return new Date().toISOString() }
function future(ms) { return new Date(Date.now() + ms).toISOString() }
function string(record, field) { return record && typeof record.getString === 'function' ? record.getString(field) : record?.[field] }
function number(record, field) { return record && typeof record.getInt === 'function' ? record.getInt(field) : Number(record?.[field] || 0) }
function bool(record, field) { return record && typeof record.getBool === 'function' ? record.getBool(field) : Boolean(record?.[field]) }
function set(record, field, value) { record.set(field, value); return record }
function jsonField(record, field) {
  let value = null
  if (typeof record?.getString === 'function') {
    try {
      const text = record.getString(field)
      if (text) {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object') return parsed
      }
    } catch (_) {}
  }
  try { value = record.get(field) } catch (_) {}
  if (value == null) value = record?.[field]
  if (typeof value === 'string') { try { return JSON.parse(value || '{}') } catch (_) { return {} } }
  if (value && typeof value === 'object') {
    try { return JSON.parse(JSON.stringify(value)) } catch (_) { return value }
  }
  return {}
}

function randomSecret(length = 32) {
  return typeof $security !== 'undefined' && $security.randomString ? $security.randomString(length) : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function hashSecret(value) {
  if (typeof $security !== 'undefined' && $security.sha256) return $security.sha256(String(value))
  return String(value)
}

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function invalid(message, field = 'payload') { const error = new Error(message); error.field = field; return error }

function sanitizePayload(action, payload) {
  if (!ACTIONS.includes(action)) throw invalid('Unsupported command action', 'action')
  if (!plainObject(payload)) throw invalid('Payload must be an object')
  if (action === 'open_video') {
    if (typeof payload.videoId !== 'string' || !VIDEO_ID.test(payload.videoId)) throw invalid('videoId is invalid', 'videoId')
    return { videoId: payload.videoId }
  }
  if (action === 'seek') {
    if (typeof payload.seekSeconds !== 'number' || !Number.isFinite(payload.seekSeconds) || payload.seekSeconds < 0 || payload.seekSeconds > 86400) throw invalid('seekSeconds is invalid', 'seekSeconds')
    return { seekSeconds: Math.round(payload.seekSeconds * 1000) / 1000 }
  }
  if (Object.keys(payload).length !== 0) throw invalid('This action does not accept payload fields')
  return {}
}

function sanitizeState(input) {
  if (!plainObject(input)) throw invalid('State must be an object', 'state')
  const connectionStates = ['connected', 'connecting', 'disconnected', 'error']
  const playerStates = ['playing', 'paused', 'buffering', 'ended', 'unstarted', 'unknown']
  if (!connectionStates.includes(input.connectionState)) throw invalid('connectionState is invalid', 'connectionState')
  if (input.videoId != null && (typeof input.videoId !== 'string' || !VIDEO_ID.test(input.videoId))) throw invalid('videoId is invalid', 'videoId')
  if (input.playerState != null && !playerStates.includes(input.playerState)) throw invalid('playerState is invalid', 'playerState')
  for (const key of ['positionSeconds', 'durationSeconds']) {
    if (input[key] != null && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 86400)) throw invalid(`${key} is invalid`, key)
  }
  if (input.lastCommandSequence != null && (!Number.isInteger(input.lastCommandSequence) || input.lastCommandSequence < 0)) throw invalid('lastCommandSequence is invalid', 'lastCommandSequence')
  return {
    connectionState: input.connectionState,
    videoId: input.videoId || null,
    playerState: input.playerState || 'unknown',
    positionSeconds: input.positionSeconds == null ? null : Math.round(input.positionSeconds * 1000) / 1000,
    durationSeconds: input.durationSeconds == null ? null : Math.round(input.durationSeconds * 1000) / 1000,
    lastCommandSequence: input.lastCommandSequence || 0,
  }
}

function collection(name) { return $app.findCollectionByNameOrId(name) }
function find(id, name) { try { return $app.findRecordById(name, id) } catch (_) { return null } }
function first(name, filter, params) {
  try { return $app.findFirstRecordByFilter(name, filter, params || {}) } catch (_) { return null }
}
function save(record) { $app.save(record); return record }
function newRecord(name) { return new Record(collection(name)) }
function recordId(record) { return record?.id || record?.getString?.('id') }
function recordName(record) { return record?.collection?.()?.name || record?.collection?.name || '' }
function isTabletAdmin(auth) {
  if (!auth || bool(auth, 'revoked')) return false
  const role = string(auth, 'role')
  return role === 'tablet_admin' && (recordName(auth) === 'users' || recordName(auth) === '_pb_users_auth_')
}
function isDevice(auth) { return Boolean(auth) && recordName(auth) === 'controller_devices' && !bool(auth, 'revoked') }
function requireDevice(c) { const auth = authRecord(c); return isDevice(auth) ? auth : null }
function requireTablet(c) { const auth = authRecord(c); return isTabletAdmin(auth) ? auth : null }

function sessionFor(c, auth, body) {
  const sessionId = body.sessionId || query(c, 'sessionId')
  const generation = Number(body.generation || query(c, 'generation'))
  if (!sessionId || !Number.isInteger(generation) || generation < 1) throw new Error('session_required')
  const session = find(sessionId, 'controller_sessions')
  if (!session || string(session, 'device') !== recordId(auth)) throw new Error('session_forbidden')
  if (string(session, 'expires_at') && new Date(string(session, 'expires_at')).getTime() <= Date.now()) throw new Error('session_expired')
  if (number(session, 'generation') !== generation || number(auth, 'session_generation') !== generation) throw new Error('stale_session')
  return { session, generation }
}

function commandView(command) {
  const payload = jsonField(command, 'payload')
  const result = { id: recordId(command), sequence: number(command, 'sequence'), idempotencyKey: string(command, 'idempotency_key'), action: string(command, 'action'), expiresAt: string(command, 'expires_at'), status: string(command, 'status') }
  if (payload.videoId) result.videoId = payload.videoId
  if (payload.seekSeconds != null) result.seekSeconds = payload.seekSeconds
  if (string(command, 'error_code')) result.errorCode = string(command, 'error_code')
  return result
}

globalThis.__controllerProtocol = {
  ACTIONS, TERMINAL, requestInfo, requestData, authRecord, query, jsonError, now, future, string, number, bool, set,
  randomSecret, hashSecret, sanitizePayload, sanitizeState, collection, find, first, save, newRecord, recordId,
  recordName, isTabletAdmin, isDevice, requireDevice, requireTablet, sessionFor, jsonField, commandView,
}

routerAdd('POST', '/api/karaoke/controllers/enroll', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requestData, jsonError, hashSecret, string, now, randomSecret, set, recordId } = globalThis.__controllerProtocol
  const body = requestData(c)
  if (typeof body.token !== 'string' || typeof body.deviceName !== 'string' || !body.deviceName.trim()) return jsonError(c, 400, 'invalid_request', 'token and deviceName are required')
  let result
  try {
    $app.runInTransaction((txApp) => {
      const grant = txApp.findFirstRecordByFilter('controller_enrollment_grants', 'grant_hash = {:hash}', { hash: hashSecret(body.token) })
      if (!grant || string(grant, 'used_at') || new Date(string(grant, 'expires_at')).getTime() <= Date.now()) throw new Error('enrollment_grant_invalid')
      const deviceKey = `device_${randomSecret(20)}`
      const deviceSecret = randomSecret(48)
      const device = new Record(txApp.findCollectionByNameOrId('controller_devices'))
      set(device, 'email', `${deviceKey}@controller.invalid`); set(device, 'password', deviceSecret); set(device, 'passwordConfirm', deviceSecret)
      set(device, 'device_name', body.deviceName.trim().slice(0, 120)); set(device, 'revoked', false); set(device, 'command_sequence', 0); set(device, 'session_generation', 0)
      txApp.save(device)
      set(grant, 'used_at', now()); txApp.save(grant)
      result = { deviceId: recordId(device), deviceKey: `${deviceKey}@controller.invalid`, deviceSecret }
    })
  } catch (error) {
    return jsonError(c, error.message === 'enrollment_grant_invalid' ? 410 : 500, error.message, 'Enrollment failed')
  }
  return c.json(201, result)
})

routerAdd('POST', '/api/karaoke/controllers/sessions', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requireDevice, requestData, jsonError, recordId, string, number, set, now, future } = globalThis.__controllerProtocol
  const auth = requireDevice(c)
  if (!auth) return jsonError(c, 403, 'forbidden', 'Controller device authentication required')
  const body = requestData(c)
  const resumeId = body.resumeSessionId || null
  let result
  try {
    $app.runInTransaction((txApp) => {
      const txAuth = txApp.findRecordById('controller_devices', recordId(auth))
      const previous = resumeId ? txApp.findRecordById('controller_sessions', resumeId) : null
      if (previous && (string(previous, 'device') !== recordId(txAuth) || new Date(string(previous, 'expires_at')).getTime() <= Date.now())) throw new Error('session_not_resumable')
      const currentGeneration = number(txAuth, 'session_generation')
      if (previous && number(previous, 'generation') === currentGeneration) {
        // A resumed authenticated session is a fresh liveness observation too. Queue
        // admission deliberately uses this field rather than trusting an old session.
        set(previous, 'expires_at', future(15 * 60 * 1000)); txApp.save(previous)
        set(txAuth, 'last_seen_at', now()); txApp.save(txAuth)
        result = { id: recordId(previous), generation: currentGeneration, expiresAt: string(previous, 'expires_at'), resumed: true }
        return
      }
      const generation = currentGeneration + 1
      set(txAuth, 'session_generation', generation); set(txAuth, 'last_seen_at', now()); txApp.save(txAuth)
      const staleCommands = txApp.findRecordsByFilter('controller_commands', 'device = {:device} && session_generation < {:generation} && status = "pending"', '', 200, 0, { device: recordId(txAuth), generation })
      staleCommands.forEach((command) => { set(command, 'status', 'failed'); set(command, 'error_code', 'stale_session'); txApp.save(command) })
      const session = new Record(txApp.findCollectionByNameOrId('controller_sessions'))
      set(session, 'device', recordId(txAuth)); set(session, 'generation', generation); set(session, 'expires_at', future(15 * 60 * 1000))
      if (previous) set(session, 'resumed_from', recordId(previous))
      txApp.save(session)
      result = { id: recordId(session), generation, expiresAt: string(session, 'expires_at'), resumed: Boolean(previous) }
    })
  } catch (error) {
    return jsonError(c, 409, error.message, 'Session cannot be started or resumed')
  }
  return c.json(201, result)
})

routerAdd('POST', '/api/karaoke/controller-commands', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requireTablet, requestData, jsonError, bool, find, number, sanitizePayload, jsonField, string, recordId, set, now, future, commandView } = globalThis.__controllerProtocol
  const auth = requireTablet(c)
  if (!auth) return jsonError(c, 403, 'forbidden', 'tablet_admin authentication required')
  const body = requestData(c)
  if (typeof body.deviceId !== 'string' || typeof body.action !== 'string' || typeof body.idempotencyKey !== 'string') return jsonError(c, 400, 'invalid_request', 'deviceId, action, and idempotencyKey are required')
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey)) return jsonError(c, 400, 'invalid_idempotency_key', 'idempotencyKey is invalid')
  const device = find(body.deviceId, 'controller_devices')
  if (!device || bool(device, 'revoked')) return jsonError(c, 404, 'device_not_found', 'Controller device is unavailable')
  if (number(device, 'session_generation') < 1) return jsonError(c, 409, 'device_session_required', 'Controller device has not started a session')
  let activeSession = null
  try {
    const sessions = $app.findRecordsByFilter('controller_sessions', 'device = {:device} && generation = {:generation}', '-expires_at', 5, 0, { device: recordId(device), generation: number(device, 'session_generation') })
    activeSession = sessions.find((candidate) => new Date(string(candidate, 'expires_at')).getTime() > Date.now()) || null
  } catch (_) {}
  if (!activeSession) return jsonError(c, 409, 'controller_session_inactive', 'Controller device has no active session')
  let payload
  try { payload = sanitizePayload(body.action, body.payload || {}) } catch (error) { return jsonError(c, 422, 'invalid_payload', error.message) }
  let result
  try {
    $app.runInTransaction((txApp) => {
      let duplicate = null
      try { duplicate = txApp.findFirstRecordByFilter('controller_commands', 'device = {:device} && idempotency_key = {:key}', { device: recordId(device), key: body.idempotencyKey }) } catch (_) {}
      if (duplicate) {
        let duplicatePayload = jsonField(duplicate, 'payload')
        try { const rawPayload = string(duplicate, 'payload'); if (rawPayload) duplicatePayload = JSON.parse(rawPayload) } catch (_) {}
        duplicatePayload = JSON.stringify(duplicatePayload)
        if (string(duplicate, 'action') !== body.action || duplicatePayload !== JSON.stringify(payload)) throw new Error('idempotency_conflict')
        result = { ...commandView(duplicate), duplicate: true }
        return
      }
      const txDevice = txApp.findRecordById('controller_devices', recordId(device))
      const sequence = number(txDevice, 'command_sequence') + 1
      set(txDevice, 'command_sequence', sequence); txApp.save(txDevice)
      const command = new Record(txApp.findCollectionByNameOrId('controller_commands'))
      set(command, 'device', recordId(txDevice)); set(command, 'session_generation', number(txDevice, 'session_generation')); set(command, 'sequence', sequence)
      set(command, 'idempotency_key', body.idempotencyKey); set(command, 'action', body.action); set(command, 'payload', payload); set(command, 'expires_at', future(30000)); set(command, 'status', 'pending'); set(command, 'issued_by', recordId(auth)); txApp.save(command)
      result = commandView(command)
    })
  } catch (error) {
    return jsonError(c, error.message === 'idempotency_conflict' ? 409 : 500, error.message, 'Command issuance failed')
  }
  return c.json(result.duplicate ? 200 : 201, result)
})

routerAdd('GET', '/api/karaoke/controllers/commands', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requireDevice, requestData, jsonError, sessionFor, recordId, string, number, set, save, commandView, query } = globalThis.__controllerProtocol
  const auth = requireDevice(c)
  if (!auth) return jsonError(c, 403, 'forbidden', 'Controller device authentication required')
  try {
    const session = sessionFor(c, auth, {})
    const after = Math.max(0, Number(query(c, 'after') || 0))
    let commands = []
    let currentSession
    $app.runInTransaction((txApp) => {
      const txDevice = txApp.findRecordById('controller_devices', recordId(auth))
      const txSession = txApp.findRecordById('controller_sessions', recordId(session.session))
      if (string(txSession, 'device') !== recordId(txDevice) || number(txSession, 'generation') !== session.generation || number(txDevice, 'session_generation') !== session.generation) throw new Error('stale_session')
      if (new Date(string(txSession, 'expires_at')).getTime() <= Date.now()) throw new Error('session_expired')
      currentSession = txSession
      const records = txApp.findRecordsByFilter('controller_commands', 'device = {:device} && session_generation = {:generation} && status = "pending"', '+sequence', 100, 0, { device: recordId(txDevice), generation: session.generation })
      commands = records.flatMap((command) => {
        if (new Date(string(command, 'expires_at')).getTime() <= Date.now()) { set(command, 'status', 'failed'); set(command, 'error_code', 'expired'); txApp.save(command); return [] }
        return [commandView(command)]
      })
    })
    return c.json(200, { sessionId: string(currentSession, 'id') || recordId(currentSession), generation: session.generation, commands })
  } catch (error) { return jsonError(c, 409, error.message, 'Session is not current') }
})

routerAdd('POST', '/api/karaoke/controllers/commands/{id}/ack', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requireDevice, requestData, jsonError, sessionFor, find, string, number, recordId, set, save, now, commandView, TERMINAL } = globalThis.__controllerProtocol
  const auth = requireDevice(c)
  if (!auth) return jsonError(c, 403, 'forbidden', 'Controller device authentication required')
  const body = requestData(c)
  if (!TERMINAL.includes(body.status)) return jsonError(c, 400, 'invalid_ack_status', 'status must be succeeded or failed')
  try {
    let result
    let ackError = null
    $app.runInTransaction((txApp) => {
      const device = txApp.findRecordById('controller_devices', recordId(auth))
      const session = txApp.findRecordById('controller_sessions', body.sessionId)
      const generation = Number(body.generation)
      if (string(session, 'device') !== recordId(device) || number(session, 'generation') !== generation || number(device, 'session_generation') !== generation) throw new Error('stale_session')
      if (new Date(string(session, 'expires_at')).getTime() <= Date.now()) throw new Error('session_expired')
      const command = txApp.findRecordById('controller_commands', c.request.pathValue('id'))
      if (string(command, 'device') !== recordId(device) || number(command, 'session_generation') !== generation) throw new Error('command_forbidden')
      const status = string(command, 'status')
      if (status !== 'pending') {
        if (status !== body.status) throw new Error('command_already_terminal')
        result = commandView(command)
        return
      }
      if (new Date(string(command, 'expires_at')).getTime() <= Date.now()) {
        set(command, 'status', 'failed'); set(command, 'error_code', 'expired'); txApp.save(command); ackError = 'command_expired'; return
      }
      set(command, 'status', body.status); set(command, 'error_code', body.status === 'failed' ? String(body.errorCode || 'device_error').slice(0, 120) : ''); set(command, 'acked_at', now()); txApp.save(command)
      result = commandView(command)
    })
    if (ackError) return jsonError(c, 409, ackError, 'Command expired before acknowledgement')
    return c.json(200, result)
  } catch (error) { return jsonError(c, 409, error.message, 'Session or command is not current') }
})

routerAdd('PUT', '/api/karaoke/controllers/state', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { requireDevice, requestData, jsonError, sanitizeState, sessionFor, first, newRecord, recordId, number, set, now, string, save } = globalThis.__controllerProtocol
  const auth = requireDevice(c)
  if (!auth) return jsonError(c, 403, 'forbidden', 'Controller device authentication required')
  const body = requestData(c)
  let sanitized
  try { sanitized = sanitizeState(body) } catch (error) { return jsonError(c, 422, 'invalid_state', error.message) }
  try {
    let result
    $app.runInTransaction((txApp) => {
      const device = txApp.findRecordById('controller_devices', recordId(auth))
      const session = txApp.findRecordById('controller_sessions', body.sessionId)
      const generation = Number(body.generation)
      if (string(session, 'device') !== recordId(device) || number(session, 'generation') !== generation || number(device, 'session_generation') !== generation) throw new Error('stale_session')
      if (new Date(string(session, 'expires_at')).getTime() <= Date.now()) throw new Error('session_expired')
      // A valid state report is the controller heartbeat used by party binding and
      // start-next. Keep device liveness in the same transaction as state persistence.
      set(device, 'last_seen_at', now()); txApp.save(device)
      let state
      try { state = txApp.findFirstRecordByFilter('controller_state', 'device = {:device}', { device: recordId(device) }) } catch (_) { state = new Record(txApp.findCollectionByNameOrId('controller_state')) }
      set(state, 'device', recordId(device)); set(state, 'session_generation', generation); set(state, 'connection_state', sanitized.connectionState); set(state, 'video_id', sanitized.videoId || ''); set(state, 'player_state', sanitized.playerState); set(state, 'position_seconds', sanitized.positionSeconds); set(state, 'duration_seconds', sanitized.durationSeconds); set(state, 'last_command_sequence', sanitized.lastCommandSequence); set(state, 'observed_at', now()); txApp.save(state)
      result = { deviceId: recordId(device), generation, observedAt: string(state, 'observed_at'), ...sanitized }
    })
    return c.json(200, result)
  } catch (error) { return jsonError(c, 409, error.message, 'Session is not current') }
})

// Operator-only helper route. It is deliberately not reachable by browser tablet accounts.
routerAdd('POST', '/api/karaoke/controllers/enrollment-grants', (c) => {
  try { require(__hooks + '/controller_protocol.pb.js') } catch (_) {}
  const { authRecord, requestData, jsonError, randomSecret, newRecord, recordId, recordName, set, future, hashSecret, string, save } = globalThis.__controllerProtocol
  const auth = authRecord(c)
  const superuser = auth && ((typeof auth.isSuperuser === 'function' && auth.isSuperuser()) || recordName(auth) === '_superusers')
  if (!superuser) return jsonError(c, 403, 'forbidden', 'PocketBase operator authentication required')
  const body = requestData(c)
  const ttlMinutes = Math.min(60, Math.max(1, Number(body.ttlMinutes || 15)))
  const token = randomSecret(32)
  const grant = newRecord('controller_enrollment_grants')
  set(grant, 'grant_hash', hashSecret(token)); set(grant, 'expires_at', future(ttlMinutes * 60 * 1000)); set(grant, 'created_by', recordId(auth)); save(grant)
  return c.json(201, { token, expiresAt: string(grant, 'expires_at') })
})

// PocketBase serializes route callbacks and executes them in a worker VM. Expose the helper
// contract so callbacks can re-load this hook module in that VM without relying on closures.
globalThis.__controllerProtocol = {
  ACTIONS, TERMINAL, requestInfo, requestData, authRecord, jsonError, now, future, string, number, bool, set,
  randomSecret, hashSecret, sanitizePayload, sanitizeState, collection, find, first, save, newRecord, recordId,
  recordName, isTabletAdmin, isDevice, requireDevice, requireTablet, sessionFor, jsonField, commandView,
}
