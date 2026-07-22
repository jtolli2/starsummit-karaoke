// Party lifecycle and fair-rotation queue API. Collection writes remain locked by schema rules.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const PARTY_TTL = 12 * 60 * 60 * 1000
const REQUEST_GAP = 30 * 1000
const JOIN_WINDOW = 60 * 1000
const JOIN_LIMIT = 20
const PARTY_REQUEST_LIMIT = 20
const CONTROLLER_STATE_TTL = 90 * 1000
const joinAttempts = Object.create(null)

function info(c) { try { return c.requestInfo ? c.requestInfo() || {} : $apis.requestInfo(c) || {} } catch (_) { return {} } }
function body(c) { const i = info(c); return i.body && typeof i.body === 'object' ? i.body : i.data && typeof i.data === 'object' ? i.data : {} }
function auth(c) { return info(c).auth || null }
function bearer(c) { const h = info(c).headers || {}; const value = h.authorization || h.Authorization || ''; return String(value).replace(/^Bearer\s+/i, '') }
function query(c, key) { const value = info(c).query?.[key]; return Array.isArray(value) ? value[0] : value }
function now() { return new Date().toISOString() }
function future(ms) { return new Date(Date.now() + ms).toISOString() }
function str(r, f) { return r && r.getString ? r.getString(f) : r?.[f] }
function num(r, f) { return r && r.getInt ? r.getInt(f) : Number(r?.[f] || 0) }
function set(r, f, v) { r.set(f, v); return r }
function id(r) { return r?.id || r?.getString?.('id') }
function name(r) { return r?.collection?.()?.name || r?.collection?.name || '' }
function tablet(a) { return a && !a.getBool?.('revoked') && str(a, 'role') === 'tablet_admin' && ['users', '_pb_users_auth_'].includes(name(a)) }
function hash(v) { return typeof $security !== 'undefined' && $security.sha256 ? $security.sha256(String(v)) : String(v) }
function random(n) { return typeof $security !== 'undefined' && $security.randomString ? $security.randomString(n) : Math.random().toString(36).slice(2) + Date.now().toString(36) }
function code() {
  if (typeof $security !== 'undefined' && $security.randomString) {
    const raw = $security.randomString(128).toUpperCase(); let out = ''
    for (const ch of raw) { if (CODE_ALPHABET.includes(ch)) out += ch; if (out.length === 8) break }
    if (out.length === 8) return out
  }
  throw new Error('secure_random_unavailable')
}
function json(c, status, error, message, extra) { return c.json(status, { error, message, ...(extra || {}) }) }
function activeParty(p) { return p && str(p, 'status') === 'active' && new Date(str(p, 'expires_at')).getTime() > Date.now() }
function find(name, filter, params) { try { return $app.findFirstRecordByFilter(name, filter, params || {}) } catch (_) { return null } }
function records(name, filter, sort, limit, params) { try { return $app.findRecordsByFilter(name, filter, sort || '', limit || 200, 0, params || {}) } catch (_) { return [] } }
function chooseNext(pending) {
  const first = Object.create(null)
  for (const q of pending.slice().sort((a, b) => num(a, 'sequence') - num(b, 'sequence'))) {
    const requester = str(q, 'requester'); if (!first[requester]) first[requester] = q
  }
  return Object.values(first).sort((a, b) => {
    const ga = find('karaoke_guest_identities', 'id = {:id}', { id: str(a, 'requester') })
    const gb = find('karaoke_guest_identities', 'id = {:id}', { id: str(b, 'requester') })
    const ta = ga && str(ga, 'last_served_at') ? new Date(str(ga, 'last_served_at')).getTime() : 0
    const tb = gb && str(gb, 'last_served_at') ? new Date(str(gb, 'last_served_at')).getTime() : 0
    return ta - tb || num(a, 'sequence') - num(b, 'sequence') || String(str(a, 'requester')).localeCompare(String(str(b, 'requester')))
  })[0] || null
}
function requireGuest(c, input) {
  const credential = input.credential || bearer(c)
  if (typeof credential !== 'string' || credential.length < 16) throw new Error('guest_credential_required')
  const guest = find('karaoke_guest_identities', 'credential_hash = {:hash}', { hash: hash(credential) })
  if (!guest || new Date(str(guest, 'expires_at')).getTime() <= Date.now()) throw new Error('guest_credential_expired')
  const party = $app.findRecordById('karaoke_parties', str(guest, 'party'))
  if (!activeParty(party)) throw new Error('party_expired')
  return { guest, party, credential }
}
function songView(q, song) { return { id: id(q), sequence: num(q, 'sequence'), status: str(q, 'status'), requestedAt: str(q, 'requested_at'), song: { id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist') } } }

// Tablet-facing state is deliberately assembled here instead of exposing the
// controller collections through PocketBase rules.  In particular, auth
// emails/passwords, session records and command payloads never cross this API.
function tabletControllerView(party) {
  const deviceId = str(party, 'controller_device')
  if (!deviceId) return { connected: false, connectionState: 'disconnected', device: null, state: null }
  const device = find('controller_devices', 'id = {:id}', { id: deviceId })
  if (!device || (device.getBool ? device.getBool('revoked') : Boolean(device.revoked))) {
    return { connected: false, connectionState: 'disconnected', device: null, state: null }
  }
  const generation = num(device, 'session_generation')
  let session = null
  try {
    session = records('controller_sessions', 'device = {:device} && generation = {:generation}', '-expires_at', 5, { device: deviceId, generation })
      .find((candidate) => new Date(str(candidate, 'expires_at')).getTime() > Date.now()) || null
  } catch (_) {}
  let state = null
  try { state = find('controller_state', 'device = {:device}', { device: deviceId }) } catch (_) {}
  const stateGeneration = state && num(state, 'session_generation') === generation
  const stateFresh = state && str(state, 'observed_at') && new Date(str(state, 'observed_at')).getTime() > Date.now() - CONTROLLER_STATE_TTL
  const connectionState = session ? (state && stateGeneration && stateFresh ? str(state, 'connection_state') || 'connecting' : 'disconnected') : 'disconnected'
  const safeState = state && stateGeneration && stateFresh ? {
    connectionState,
    videoId: str(state, 'video_id') || null,
    playerState: str(state, 'player_state') || 'unknown',
    positionSeconds: Number.isFinite(Number(state.position_seconds)) ? Number(state.position_seconds) : (state.getFloat ? state.getFloat('position_seconds') : null),
    durationSeconds: Number.isFinite(Number(state.duration_seconds)) ? Number(state.duration_seconds) : (state.getFloat ? state.getFloat('duration_seconds') : null),
    lastCommandSequence: num(state, 'last_command_sequence'),
    observedAt: str(state, 'observed_at') || null,
  } : null
  return {
    connected: Boolean(session && safeState && connectionState === 'connected'),
    connectionState,
    device: { id: deviceId, name: str(device, 'device_name') || 'Controller', lastSeenAt: str(device, 'last_seen_at') || null },
    sessionExpiresAt: session ? str(session, 'expires_at') : null,
    state: safeState,
  }
}

globalThis.__partyQueue = { CODE_ALPHABET, YOUTUBE_ID, PARTY_TTL, REQUEST_GAP, JOIN_WINDOW, JOIN_LIMIT, PARTY_REQUEST_LIMIT, CONTROLLER_STATE_TTL, joinAttempts, info, body, auth, bearer, query, requireGuest, activeParty, tablet, hash, random, code, now, future, str, num, set, id, json, songView, tabletControllerView, find, records, chooseNext }
globalThis.__partyQueueRealtime = {
  authorize(e) {
    const topic = 'karaoke_party_wake'
    const requested = Array.isArray(e.subscriptions) ? e.subscriptions : []
    // This hook owns only the custom guest wake topic. Controller command subscriptions are
    // authorized by PocketBase collection rules and must retain their controller identity.
    if (!requested.includes(topic)) return e.next()
    try {
      const access = globalThis.__partyQueue.requireGuest({ requestInfo: () => typeof e.requestInfo === 'function' ? e.requestInfo() : e.requestInfo || {} }, {})
      if (requested.some((item) => item !== topic)) throw new ForbiddenError('Unsupported realtime topic')
      e.subscriptions = requested.includes(topic) ? [topic] : []
      e.client.set('karaokePartyId', globalThis.__partyQueue.id(access.party))
      e.next()
    } catch (_) { throw new ForbiddenError('Guest realtime authorization required') }
  },
  publish(e) {
    const record = e.record; const collection = record?.collection?.()?.name || record?.collection?.name
    if (collection !== 'karaoke_queue') return
    const partyId = globalThis.__partyQueue.str(record, 'party'); const broker = $app.subscriptionsBroker()
    const message = new SubscriptionMessage({ name: 'karaoke_party_wake', data: '{}' })
    const clients = broker.clients()
    Object.keys(clients || {}).forEach((key) => {
      const client = clients[key]
      if (client?.hasSubscription?.('karaoke_party_wake') && client.get?.('karaokePartyId') === partyId) client.send(message)
    })
  },
}

onRealtimeSubscribeRequest((e) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  globalThis.__partyQueueRealtime.authorize(e)
})
onRecordAfterCreateSuccess((e) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  try { globalThis.__partyQueueRealtime.publish(e) } finally { e.next() }
})
onRecordAfterUpdateSuccess((e) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  try { globalThis.__partyQueueRealtime.publish(e) } finally { e.next() }
})

routerAdd('POST', '/api/karaoke/parties', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { PARTY_TTL, auth, tablet, json, find, code, hash, set, future, id, str } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  let result
  try {
    $app.runInTransaction((tx) => {
      let plain; let party
      for (let i = 0; i < 8; i++) { plain = code(); if (!find('karaoke_parties', 'code_hash = {:hash}', { hash: hash(plain) })) break }
      party = new Record(tx.findCollectionByNameOrId('karaoke_parties'))
      set(party, 'code_hash', hash(plain)); set(party, 'code_hint', plain.slice(-4)); set(party, 'status', 'active'); set(party, 'expires_at', future(PARTY_TTL)); set(party, 'created_by', id(auth(c))); set(party, 'join_count', 0); tx.save(party)
      result = { id: id(party), code: plain, expiresAt: str(party, 'expires_at') }
    })
  } catch (_) { return json(c, 500, 'party_create_failed', 'Party could not be created') }
  return c.json(201, result)
})

routerAdd('POST', '/api/karaoke/parties/join', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { joinAttempts, JOIN_WINDOW, JOIN_LIMIT, body, info, json, find, hash, activeParty, id, random, set, str, num, now } = globalThis.__partyQueue
  const input = body(c)
  const remote = String(info(c).remoteIp || info(c).remoteIP || 'unknown'); const cutoff = Date.now() - JOIN_WINDOW
  // Durable party/IP limiter; the in-memory map remains a bounded fast-path cache.
  const ipKey = hash(remote)
  const cached = joinAttempts[ipKey] || []
  joinAttempts[ipKey] = cached.filter((stamp) => stamp > cutoff).slice(-JOIN_LIMIT)
  if (joinAttempts[ipKey].length >= JOIN_LIMIT) return json(c, 429, 'rate_limited', 'Too many party join attempts')
  if (typeof input.code !== 'string' || !/^[A-Za-z0-9]{6,16}$/.test(input.code)) return json(c, 400, 'invalid_code', 'A valid party code is required')
  const party = find('karaoke_parties', 'code_hash = {:hash}', { hash: hash(input.code.toUpperCase()) })
  if (!activeParty(party)) return json(c, 410, 'party_expired', 'This party is expired or unavailable')
  let result
  try {
    $app.runInTransaction((tx) => {
      const txParty = tx.findRecordById('karaoke_parties', id(party));
      let limiter = null; try { limiter = tx.findFirstRecordByFilter('karaoke_join_attempts', 'party = {:party} && ip_hash = {:ip}', { party: id(txParty), ip: ipKey }) } catch (_) {}
      const nowMs = Date.now();
      if (!limiter) { limiter = new Record(tx.findCollectionByNameOrId('karaoke_join_attempts')); set(limiter, 'party', id(txParty)); set(limiter, 'ip_hash', ipKey); set(limiter, 'window_started_at', now()); set(limiter, 'attempts', 0) }
      const started = new Date(str(limiter, 'window_started_at')).getTime();
      if (started <= cutoff) { set(limiter, 'window_started_at', now()); set(limiter, 'attempts', 0) }
      if (num(limiter, 'attempts') >= JOIN_LIMIT) throw new Error('rate_limited')
      set(limiter, 'attempts', num(limiter, 'attempts') + 1); tx.save(limiter)
      const credential = random(40)
      const guest = new Record(tx.findCollectionByNameOrId('karaoke_guest_identities'))
      set(guest, 'party', id(txParty)); set(guest, 'credential_hash', hash(credential)); set(guest, 'expires_at', str(txParty, 'expires_at')); set(guest, 'request_count', 0); tx.save(guest)
      set(txParty, 'last_join_at', now()); set(txParty, 'join_count', num(txParty, 'join_count') + 1); tx.save(txParty)
      result = { partyId: id(txParty), credential, expiresAt: str(txParty, 'expires_at') }
    })
  } catch (error) { return json(c, error.message === 'rate_limited' ? 429 : 500, error.message === 'rate_limited' ? 'rate_limited' : 'join_failed', error.message === 'rate_limited' ? 'Too many party join attempts' : 'Party join failed') }
  joinAttempts[ipKey] = (joinAttempts[ipKey] || []).concat(Date.now()).slice(-JOIN_LIMIT)
  const keys = Object.keys(joinAttempts)
  if (keys.length > 2048) keys.slice(0, keys.length - 2048).forEach((key) => { delete joinAttempts[key] })
  return c.json(201, result)
})

routerAdd('GET', '/api/karaoke/parties/queue', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { requireGuest, body, records, id, str, songView, json } = globalThis.__partyQueue
  try {
    const { party } = requireGuest(c, body(c)); const rows = records('karaoke_queue', 'party = {:party} && (status = "queued" || status = "playing")', '+sequence', 200, { party: id(party) })
    return c.json(200, { partyId: id(party), expiresAt: str(party, 'expires_at'), queue: rows.map((q) => { const s = $app.findRecordById('karaoke_songs', str(q, 'song')); return songView(q, s) }) })
  } catch (error) { const status = ['party_expired', 'guest_credential_expired'].includes(error.message) ? 410 : 403; return json(c, status, error.message, 'Queue access denied') }
})

// Sanitized eligible-song browse/search for guests. Library collection rules remain private.
routerAdd('GET', '/api/karaoke/parties/songs', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { requireGuest, query, records, str, id, json } = globalThis.__partyQueue
  try {
    requireGuest(c, {})
    const q = String(query(c, 'q') || '').trim().slice(0, 100)
    const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
    const filter = escaped ? 'eligible = true && (title ~ {:q} || artist ~ {:q})' : 'eligible = true'
    let rows
    try {
      rows = $app.findRecordsByFilter('karaoke_songs', filter, '+title,+artist', 50, 0, escaped ? { q: escaped } : {})
    } catch (_) {
      return json(c, 500, 'song_search_failed', 'Songs could not be loaded')
    }
    return c.json(200, { songs: rows.map((song) => ({ id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist') })) })
  } catch (error) {
    const status = ['party_expired', 'guest_credential_expired'].includes(error.message) ? 410 : 403
    return json(c, status, error.message, 'Song access denied')
  }
})

routerAdd('POST', '/api/karaoke/requests', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { YOUTUBE_ID, REQUEST_GAP, PARTY_REQUEST_LIMIT, body, requireGuest, json, id, activeParty, str, find, num, set, now, songView } = globalThis.__partyQueue
  const input = body(c)
  try {
    const access = requireGuest(c, input); const youtubeId = input.youtubeId || input.songId
    if (typeof youtubeId !== 'string' || !YOUTUBE_ID.test(youtubeId)) return json(c, 422, 'invalid_song', 'A valid YouTube song id is required')
    let result
    $app.runInTransaction((tx) => {
      const guest = tx.findRecordById('karaoke_guest_identities', id(access.guest)); const party = tx.findRecordById('karaoke_parties', id(access.party))
      if (!activeParty(party)) throw new Error('party_expired')
      if (str(guest, 'last_request_at') && Date.now() - new Date(str(guest, 'last_request_at')).getTime() < REQUEST_GAP) throw new Error('rate_limited')
      const recent = tx.findRecordsByFilter('karaoke_queue', 'party = {:party} && requested_at >= {:cutoff}', '', PARTY_REQUEST_LIMIT + 1, 0, { party: id(party), cutoff: new Date(Date.now() - REQUEST_GAP).toISOString() })
      if (recent.length >= PARTY_REQUEST_LIMIT) throw new Error('rate_limited')
      let song = null; try { song = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId} && eligible = true', { youtubeId }) } catch (_) {}
      if (!song) throw new Error('song_unavailable')
      let duplicate = null; try { duplicate = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && active_song_key = {:key}', { party: id(party), key: str(song, 'youtube_id') }) } catch (_) {}
      if (duplicate) throw new Error('duplicate_song')
      const sequence = num(party, 'queue_sequence') + 1; set(party, 'queue_sequence', sequence); tx.save(party)
      const queue = new Record(tx.findCollectionByNameOrId('karaoke_queue')); set(queue, 'party', id(party)); set(queue, 'song', id(song)); set(queue, 'requester', id(guest)); set(queue, 'status', 'queued'); set(queue, 'active_song_key', str(song, 'youtube_id')); set(queue, 'sequence', sequence); set(queue, 'requested_at', now()); tx.save(queue)
      set(guest, 'last_request_at', now()); set(guest, 'request_count', num(guest, 'request_count') + 1); tx.save(guest); result = songView(queue, song)
    })
    return c.json(201, result)
  } catch (error) {
    if (String(error && error.message || error).toLowerCase().includes('unique')) return json(c, 409, 'duplicate_song', 'Song is already queued')
    const status = { rate_limited: 429, duplicate_song: 409, song_unavailable: 422, party_expired: 410, guest_credential_expired: 410, guest_credential_required: 403 }[error.message] || 500
    return json(c, status, error.message, 'Song request rejected')
  }
})

// Deterministic fair-rotation preview used by the tablet before starting the next song.
routerAdd('GET', '/api/karaoke/queue/next', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, info, records, str, find, num, id, songView } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const partyId = info(c).query?.partyId; if (!partyId) return json(c, 400, 'invalid_party', 'partyId is required')
  const pending = records('karaoke_queue', 'party = {:party} && status = "queued"', '+sequence', 500, { party: partyId })
  const byRequester = {}
  for (const q of pending) { const key = str(q, 'requester'); if (!byRequester[key]) byRequester[key] = q }
  const candidates = Object.values(byRequester)
  candidates.sort((a, b) => {
    const ga = find('karaoke_guest_identities', 'id = {:id}', { id: str(a, 'requester') }); const gb = find('karaoke_guest_identities', 'id = {:id}', { id: str(b, 'requester') })
    const ta = ga && str(ga, 'last_served_at') ? new Date(str(ga, 'last_served_at')).getTime() : 0; const tb = gb && str(gb, 'last_served_at') ? new Date(str(gb, 'last_served_at')).getTime() : 0
    return ta - tb || num(a, 'sequence') - num(b, 'sequence') || String(str(a, 'requester')).localeCompare(String(str(b, 'requester')))
  })
  if (!candidates[0]) return c.json(200, { queue: null })
  const song = $app.findRecordById('karaoke_songs', str(candidates[0], 'song'))
  return c.json(200, { queue: songView(candidates[0], song) })
})

// Authoritative, sanitized snapshot for the tablet operator UI.  This is the
// sole tablet read path for party/queue/controller state; direct collection
// rules remain locked and no controller credentials or Lounge data are sent.
routerAdd('GET', '/api/karaoke/tablet/status', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, info, find, records, id, str, songView, tabletControllerView } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const partyId = info(c).query?.partyId
  if (Array.isArray(partyId) ? !partyId[0] : !partyId) return json(c, 400, 'invalid_party', 'partyId is required')
  const party = find('karaoke_parties', 'id = {:id}', { id: Array.isArray(partyId) ? partyId[0] : partyId })
  if (!party) return json(c, 404, 'party_not_found', 'Party was not found')
  const rows = records('karaoke_queue', 'party = {:party} && (status = "queued" || status = "playing")', '+sequence', 200, { party: id(party) })
  const queue = rows.map((q) => songView(q, $app.findRecordById('karaoke_songs', str(q, 'song'))))
  return c.json(200, {
    party: { id: id(party), status: str(party, 'status'), expiresAt: str(party, 'expires_at'), codeHint: str(party, 'code_hint'), joinCount: Number(party.join_count || 0) || (party.getInt ? party.getInt('join_count') : 0) },
    queue,
    controller: tabletControllerView(party),
  })
})

// Reload recovery for a tablet account.  Party codes are intentionally not
// recoverable from their stored hash, so this returns only the safe hint.
routerAdd('GET', '/api/karaoke/tablet/active', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, records, id, str } = globalThis.__partyQueue
  const operator = auth(c)
  if (!tablet(operator)) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const active = records('karaoke_parties', 'created_by = {:operator} && status = "active" && expires_at > {:now}', '-expires_at', 1, { operator: id(operator), now: now() })[0] || null
  if (!active) return c.json(200, { party: null })
  return c.json(200, { party: { id: id(active), codeHint: str(active, 'code_hint'), expiresAt: str(active, 'expires_at'), status: str(active, 'status') } })
})

routerAdd('POST', '/api/karaoke/queue/transition', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, str, id, set, now, num, future, activeParty, CONTROLLER_STATE_TTL } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const allowed = { queued: ['playing', 'failed'], playing: ['completed', 'failed'] }
  if (!input.queueId || !allowed[input.from]?.includes(input.to)) return json(c, 422, 'invalid_transition', 'Queue transition is invalid')
  try {
    let result
    $app.runInTransaction((tx) => {
      const queue = tx.findRecordById('karaoke_queue', input.queueId); if (!queue) throw new Error('queue_not_found')
      const party = tx.findRecordById('karaoke_parties', str(queue, 'party'))
      if (!activeParty(party)) throw new Error('party_expired')
      const current = str(queue, 'status'); if (current === input.to) { result = { id: id(queue), status: current, idempotent: true }; return }
      if (current !== input.from) throw new Error('stale_transition')
      if (input.to === 'playing') {
        const deviceId = str(party, 'controller_device')
        let device = null
        try { device = deviceId ? tx.findRecordById('controller_devices', deviceId) : null } catch (_) {}
        const revoked = device && (device.getBool ? device.getBool('revoked') : Boolean(device.revoked))
        const generation = device ? num(device, 'session_generation') : 0
        let session = null; let controllerState = null
        if (device && !revoked && generation > 0) {
          try {
            const sessions = tx.findRecordsByFilter('controller_sessions', 'device = {:device} && generation = {:generation}', '-expires_at', 5, 0, { device: deviceId, generation })
            session = sessions.find((candidate) => new Date(str(candidate, 'expires_at')).getTime() > Date.now()) || null
            controllerState = tx.findFirstRecordByFilter('controller_state', 'device = {:device}', { device: deviceId })
          } catch (_) {}
        }
        const stateFresh = controllerState && str(controllerState, 'observed_at') && new Date(str(controllerState, 'observed_at')).getTime() > Date.now() - CONTROLLER_STATE_TTL
        if (!session || !controllerState || !stateFresh || num(controllerState, 'session_generation') !== generation || str(controllerState, 'connection_state') !== 'connected') throw new Error('controller_unavailable')
        let alreadyPlaying = null
        try { alreadyPlaying = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && status = "playing" && id != {:id}', { party: str(queue, 'party'), id: id(queue) }) } catch (_) {}
        if (alreadyPlaying) throw new Error('party_already_playing')
        const pending = tx.findRecordsByFilter('karaoke_queue', 'party = {:party} && status = "queued"', '+sequence', 500, 0, { party: str(queue, 'party') })
        const firstByRequester = Object.create(null)
        for (const item of pending) { const requester = str(item, 'requester'); if (!firstByRequester[requester]) firstByRequester[requester] = item }
        const candidate = Object.values(firstByRequester).sort((a, b) => {
          const ga = tx.findRecordById('karaoke_guest_identities', str(a, 'requester')); const gb = tx.findRecordById('karaoke_guest_identities', str(b, 'requester'))
          const ta = ga && str(ga, 'last_served_at') ? new Date(str(ga, 'last_served_at')).getTime() : 0; const tb = gb && str(gb, 'last_served_at') ? new Date(str(gb, 'last_served_at')).getTime() : 0
          return ta - tb || num(a, 'sequence') - num(b, 'sequence') || String(str(a, 'requester')).localeCompare(String(str(b, 'requester')))
        })[0]
        if (!candidate || id(candidate) !== id(queue)) throw new Error('not_next')
      }
      set(queue, 'status', input.to); if (input.to === 'playing') set(queue, 'started_at', now()); else { set(queue, 'completed_at', now()); set(queue, 'active_song_key', null) } if (input.to === 'failed') set(queue, 'failure_reason', String(input.failureReason || 'playback_failed').slice(0, 160)); tx.save(queue)
      if (input.to === 'playing') {
        const guest = tx.findRecordById('karaoke_guest_identities', str(queue, 'requester')); if (guest) { set(guest, 'last_served_at', now()); tx.save(guest) }
        const deviceId = party && str(party, 'controller_device')
        if (deviceId) {
          const device = tx.findRecordById('controller_devices', deviceId); const song = tx.findRecordById('karaoke_songs', str(queue, 'song'))
          let session = null
          try {
            const sessions = tx.findRecordsByFilter('controller_sessions', 'device = {:device} && generation = {:generation}', '-expires_at', 5, 0, { device: deviceId, generation: num(device, 'session_generation') })
            session = sessions.find((candidate) => new Date(str(candidate, 'expires_at')).getTime() > Date.now()) || null
          } catch (_) {}
          const revoked = device && (device.getBool ? device.getBool('revoked') : Boolean(device.revoked))
          if (device && !revoked && song && num(device, 'session_generation') > 0 && session) {
            const sequence = num(device, 'command_sequence') + 1; set(device, 'command_sequence', sequence); tx.save(device)
            const command = new Record(tx.findCollectionByNameOrId('controller_commands')); set(command, 'device', deviceId); set(command, 'session_generation', num(device, 'session_generation')); set(command, 'sequence', sequence); set(command, 'idempotency_key', `queue-start-${id(queue)}`); set(command, 'action', 'open_video'); set(command, 'payload', { videoId: str(song, 'youtube_id') }); set(command, 'expires_at', future(30000)); set(command, 'status', 'pending'); set(command, 'issued_by', id(auth(c))); tx.save(command)
          }
        }
      }
      result = { id: id(queue), status: input.to, idempotent: false }
    })
    return c.json(200, result)
  } catch (error) {
    const status = error.message === 'queue_not_found' ? 404 : error.message === 'party_expired' ? 410 : 409
    return json(c, status, error.message, 'Queue transition rejected')
  }
})
