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
function dayKey(value = new Date()) {
  // America/Los_Angeles reset boundary (DST-aware, independent of host TZ).
  const instant = value instanceof Date ? value : new Date(value); const year = instant.getUTCFullYear()
  const sunday = (month, ordinal) => { const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (ordinal - 1) * 7 }
  const start = Date.UTC(year, 2, sunday(2, 2), 10); const end = Date.UTC(year, 10, sunday(10, 1), 9)
  const offset = instant.getTime() >= start && instant.getTime() < end ? -7 : -8; const pacific = new Date(instant.getTime() + offset * 60 * 60 * 1000)
  return `${pacific.getUTCFullYear()}-${String(pacific.getUTCMonth() + 1).padStart(2, '0')}-${String(pacific.getUTCDate()).padStart(2, '0')}`
}
function future(ms) { return new Date(Date.now() + ms).toISOString() }
function str(r, f) { return r && r.getString ? r.getString(f) : r?.[f] }
function num(r, f) { return r && r.getInt ? r.getInt(f) : Number(r?.[f] || 0) }
function set(r, f, v) { r.set(f, v); return r }
function id(r) { return r?.id || r?.getString?.('id') }
function name(r) { return r?.collection?.()?.name || r?.collection?.name || '' }
function tablet(a) { return a && !a.getBool?.('revoked') && str(a, 'role') === 'tablet_admin' && ['users', '_pb_users_auth_'].includes(name(a)) }
function hash(v) { return typeof $security !== 'undefined' && $security.sha256 ? $security.sha256(String(v)) : String(v) }
function catalogImportFailureStage(stage) {
  const stages = ['batch_create', 'batch_validate', 'song_save', 'chunk_save', 'batch_finalize']
  return stages.includes(stage) ? stage : 'unknown'
}
function logCatalogImportFailure(stage, offset, itemCount) {
  // Keep retained-staging diagnostics bounded and free of request payloads or secrets.
  try {
    const safeStage = catalogImportFailureStage(stage)
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
    const safeItemCount = Math.max(0, Math.min(100, Math.floor(Number(itemCount) || 0)))
    console.error(`Catalog import transaction failed (stage=${safeStage}, offset=${safeOffset}, itemCount=${safeItemCount})`)
  } catch (_) {}
}
const CATALOG_CHECKPOINT_HEALTH_FIELDS = {
  imports: [
    ['batch_key', 'text', true], ['source_fingerprint', 'text', true], ['source_url', 'text', false], ['source_terms', 'text', false],
    ['source_retrieved_at', 'date', false], ['cursor', 'number', false], ['status', 'select', true], ['quota_used', 'number', false],
    ['quota_limit', 'number', false], ['total', 'number', false], ['last_error', 'text', false], ['updated_at', 'date', false],
  ],
  chunks: [
    ['import', 'relation', true], ['offset', 'number', false], ['chunk_fingerprint', 'text', true], ['item_count', 'number', true], ['payload_json', 'json', false],
  ],
}
const CATALOG_CHECKPOINT_HEALTH_TYPES = ['text', 'date', 'number', 'select', 'relation', 'json']
function catalogFieldType(field) {
  if (!field) return null
  try {
    if (typeof field.type === 'function') return String(field.type() || '')
    return String(field.type || '')
  } catch (_) { return '' }
}
function catalogCheckpointFieldHealth(collection, expected) {
  const [name, expectedType, expectedRequired] = expected
  let field = null
  try { field = collection?.fields?.getByName(name) || null } catch (_) {}
  const fieldType = catalogFieldType(field)
  const type = CATALOG_CHECKPOINT_HEALTH_TYPES.includes(fieldType) ? fieldType : field ? 'other' : null
  return { name, type, required: field?.required === true, present: Boolean(field), expectedType, expectedRequired }
}
function catalogCheckpointHealth() {
  let imports = null; let chunks = null
  try { imports = $app.findCollectionByNameOrId('karaoke_catalog_imports'); chunks = $app.findCollectionByNameOrId('karaoke_catalog_import_chunks') } catch (_) { return null }
  if (!imports || !chunks) return null
  const importFields = CATALOG_CHECKPOINT_HEALTH_FIELDS.imports.map((expected) => catalogCheckpointFieldHealth(imports, expected))
  const chunkFields = CATALOG_CHECKPOINT_HEALTH_FIELDS.chunks.map((expected) => catalogCheckpointFieldHealth(chunks, expected))
  let rawRelation = null
  try { rawRelation = chunks.fields.getByName('import') || null } catch (_) {}
  const relationTargetMatches = Boolean(rawRelation && catalogFieldType(rawRelation) === 'relation' && String(rawRelation.collectionId || '') === String(imports.id || ''))
  const hasIndex = (collection, expected) => Array.isArray(collection.indexes) && collection.indexes.some((index) => String(index).replace(/\s+/g, ' ').trim() === expected)
  const importsUniqueIndex = hasIndex(imports, 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)')
  const chunksUniqueIndex = hasIndex(chunks, 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)')
  const conforms = (fields) => fields.every((field) => field.present && field.type === field.expectedType && field.required === field.expectedRequired)
  return {
    healthy: conforms(importFields) && conforms(chunkFields) && relationTargetMatches && importsUniqueIndex && chunksUniqueIndex,
    imports: { present: true, hasExpectedUniqueIndex: importsUniqueIndex, fields: importFields },
    chunks: { present: true, hasExpectedUniqueIndex: chunksUniqueIndex, relationTargetMatches, fields: chunkFields },
  }
}
function canonicalize(v) { if (Array.isArray(v)) return v.map(canonicalize); if (v && typeof v === 'object') { const out = {}; Object.keys(v).sort().forEach((key) => { out[key] = canonicalize(v[key]) }); return out } return v }
function normalized(v, max) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, max) }
function classifyCatalogItem(item) {
  const text = `${item?.title || ''} ${item?.description || ''} ${item?.channelTitle || ''}`.toLowerCase()
  if (/\b(live|concert|performance)\b/.test(text)) return { classification: 'live', confidence: 0.98, reason: 'live_performance' }
  if (/\bkaraoke\b|backing track|instrumental/.test(text)) return { classification: 'karaoke', confidence: /\bkaraoke\b/.test(text) ? 0.92 : 0.75, reason: 'karaoke_backing_signal' }
  if (/\baudio only\b|\bofficial audio\b/.test(text)) return { classification: 'fallback_audio', confidence: 0.86, reason: 'audio_fallback_signal' }
  if (/\blyrics?\b|lyric video/.test(text)) return { classification: 'fallback_lyric', confidence: 0.9, reason: 'lyric_fallback_signal' }
  if (/\bcover\b/.test(text)) return { classification: 'cover', confidence: 0.8, reason: 'cover_signal' }
  if (/\bofficial\b|music video/.test(text)) return { classification: 'original', confidence: 0.85, reason: 'original_signal' }
  return { classification: 'unknown', confidence: 0.25, reason: 'insufficient_metadata' }
}
function env(name) { try { return typeof $os !== 'undefined' && $os.getenv ? String($os.getenv(name) || '') : '' } catch (_) { return '' } }
function youtubeResponse(response) {
  const status = Number(response?.statusCode ?? response?.status ?? 0)
  let payload = response?.json
  if (typeof payload === 'function') { try { payload = payload() } catch (_) {} }
  if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch (_) {} }
  return { status, payload: payload && typeof payload === 'object' ? payload : {} }
}
function youtubeRequest(url, meter) {
  if (typeof $http === 'undefined' || !$http.send) throw new Error('youtube_http_unavailable')
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try { if (meter) meter.cost += url.includes('/search?') ? 100 : 1; response = youtubeResponse($http.send({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 15 })) } catch (error) { last = error; if (attempt < 2) continue; const out = new Error('youtube_network_error'); out.quotaCost = meter?.cost || 0; throw out }
    if (response.status >= 200 && response.status < 300) return response.payload
    last = new Error(`youtube_http_${response.status || 'unknown'}`)
    if (response.status !== 429 && response.status < 500) break
  }
  const out = last || new Error('youtube_request_failed'); out.quotaCost = meter?.cost || 0; throw out
}
function fetchYoutubeCandidates(queryText, maxResults) {
  const key = env('YOUTUBE_API_KEY'); if (!key) throw new Error('youtube_key_unconfigured')
  const q = encodeURIComponent(String(queryText || '').trim()); if (!q) throw new Error('youtube_query_required')
  const limit = Math.max(1, Math.min(50, Number(maxResults) || 10)); const meter = { cost: 0 }; const helpers = globalThis.__partyQueue || {}; const request = helpers.youtubeRequest || youtubeRequest; const videoId = helpers.YOUTUBE_ID || YOUTUBE_ID
  let search; try { search = request(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${q}&key=${encodeURIComponent(key)}`, meter) } catch (error) { error.quotaCost = meter.cost; throw error }
  const ids = (Array.isArray(search.items) ? search.items : []).map((item) => String(item?.id?.videoId || '')).filter((id) => videoId.test(id))
  if (!ids.length) return { items: [], cost: meter.cost }
  let details; try { details = request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,statistics&id=${ids.join(',')}&key=${encodeURIComponent(key)}`, meter) } catch (error) { error.quotaCost = meter.cost; throw error }
  const byId = Object.create(null); (Array.isArray(details.items) ? details.items : []).forEach((item) => { byId[String(item.id)] = item })
  const items = ids.map((youtubeId, index) => {
    const item = byId[youtubeId]; const snippet = item?.snippet || {}; const status = item?.status || {}
    return { youtubeId, title: snippet.title || youtubeId, artist: snippet.channelTitle || '', description: snippet.description || '', channelTitle: snippet.channelTitle || '', classification: undefined, embeddable: status.embeddable === true, privacyStatus: status.privacyStatus || 'unknown', uploadStatus: status.uploadStatus || 'unknown', duration: item?.contentDetails?.duration || '', viewCount: item?.statistics?.viewCount || '', sourceRank: index + 1 }
  }).filter((item) => item.embeddable && item.privacyStatus === 'public' && item.uploadStatus === 'processed'); return { items, cost: meter.cost }
}
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

globalThis.__partyQueue = { CODE_ALPHABET, YOUTUBE_ID, PARTY_TTL, REQUEST_GAP, JOIN_WINDOW, JOIN_LIMIT, PARTY_REQUEST_LIMIT, CONTROLLER_STATE_TTL, joinAttempts, info, body, auth, bearer, query, requireGuest, activeParty, tablet, hash, canonicalize, normalized, classifyCatalogItem, env, youtubeRequest, fetchYoutubeCandidates, random, code, now, future, dayKey, str, num, set, id, json, songView, tabletControllerView, find, records, chooseNext, catalogImportFailureStage, logCatalogImportFailure, catalogCheckpointHealth }
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
    const page = Math.max(1, Number(query(c, 'page') || 1) || 1)
    const perPage = Math.min(50, Math.max(1, Number(query(c, 'perPage') || 20) || 20))
    const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
    const filter = escaped ? 'eligible = true && (title ~ {:q} || artist ~ {:q})' : 'eligible = true'
    let rows
    try {
      rows = $app.findRecordsByFilter('karaoke_songs', filter, '+title,+artist,+youtube_id', perPage + 1, (page - 1) * perPage, escaped ? { q: escaped } : {})
    } catch (_) {
      return json(c, 500, 'song_search_failed', 'Songs could not be loaded')
    }
    const hasMore = rows.length > perPage
    const songs = rows.slice(0, perPage).map((song) => ({ id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist') }))
    return c.json(200, { page, perPage, hasMore, songs })
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

// Operator-only catalog moderation. These routes intentionally expose no YouTube API
// credentials and return only reviewable metadata.
routerAdd('GET', '/api/karaoke/tablet/catalog/checkpoint-health', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, catalogCheckpointHealth } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const health = catalogCheckpointHealth()
  if (!health) return json(c, 503, 'catalog_checkpoint_unavailable', 'Catalog import checkpoint schema is unavailable')
  return c.json(200, health)
})

routerAdd('GET', '/api/karaoke/tablet/catalog', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, query, records, str, id, num } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const page = Math.max(1, Number(query(c, 'page') || 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query(c, 'perPage') || 25) || 25))
  const review = String(query(c, 'review') || '').trim(); const classification = String(query(c, 'classification') || '').trim()
  const clauses = []; const params = {}
  if (review === 'pending') clauses.push('(review_status = "unreviewed" || review_status = "needs_review")')
  else if (review) { clauses.push('review_status = {:review}'); params.review = review }
  if (classification) { clauses.push('classification = {:classification}'); params.classification = classification }
  const filter = clauses.join(' && ') || ''
  let rows = []; try { rows = $app.findRecordsByFilter('karaoke_songs', filter, '+title,+youtube_id', perPage + 1, (page - 1) * perPage, params) } catch (_) { return json(c, 500, 'catalog_failed', 'Catalog could not be loaded') }
  const hasMore = rows.length > perPage; const sliced = rows.slice(0, perPage)
  // Extra-row pagination avoids loading an unbounded catalog while still giving
  // the UI an accurate next-page boundary. The final page resolves its true total.
  const totalItems = (page - 1) * perPage + sliced.length + (hasMore ? 1 : 0)
  const totalPages = page + (hasMore ? 1 : 0)
  return c.json(200, { page, perPage, totalItems, totalPages, songs: sliced.map((song) => ({ id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist'), eligible: song.getBool ? song.getBool('eligible') : false, classification: str(song, 'classification') || 'unknown', reviewState: str(song, 'review_status') || 'unreviewed', provenance: str(song, 'provenance'), replacementYoutubeId: str(song, 'replacement_youtube_id'), importedAt: str(song, 'imported_at') })) })
})

routerAdd('POST', '/api/karaoke/tablet/catalog/import', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, future, find, set, num, hash, canonicalize, normalized, classifyCatalogItem, fetchYoutubeCandidates, dayKey, random, id, str, catalogImportFailureStage, logCatalogImportFailure } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const live = input.fetchFromYoutube === true
  const batchKey = String(input.batchKey || '').trim(); let items = Array.isArray(input.items) ? input.items.slice(0, 100) : []; const offset = Number(input.offset)
  const manifestFingerprint = String(input.manifestFingerprint || ''); let total = Number(input.total); const source = input.source && typeof input.source === 'object' ? input.source : {}; const sourceUrl = String(source.url || (live ? 'https://www.youtube.com' : '')).slice(0, 500); const sourceTerms = String(source.terms || input.query || '').slice(0, 500)
  const requestedMaxResults = Math.max(1, Math.min(50, Number(input.requestedMaxResults || total) || 10)); const requestFingerprint = hash(JSON.stringify(canonicalize(live ? { batchKey, manifestFingerprint, query: String(input.query || ''), requestedMaxResults, offset } : { offset, items })))
  if (!batchKey || (!live && !items.length) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || (live ? (offset !== 0 || total !== requestedMaxResults) : total < offset + items.length) || !/^[a-f0-9]{64}$/i.test(manifestFingerprint)) return json(c, 422, 'invalid_import', 'batchKey, manifestFingerprint, total, offset, and items are required')
  if (live) { let key = ''; try { key = String($os.getenv('YOUTUBE_API_KEY') || '') } catch (_) {} if (!key) return json(c, 503, 'youtube_key_unconfigured', 'Live YouTube import is temporarily unavailable'); if (!String(input.query || '').trim()) return json(c, 422, 'youtube_query_required', 'A search query is required') }
  let ownerToken = ''
  let attemptedCost = 0
  if (live) {
    try {
      ownerToken = hash(`${batchKey}:${requestFingerprint}:${random(24)}`)
      $app.runInTransaction((tx) => {
        let batch = null; try { batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }) } catch (_) {}
        if (batch && (str(batch, 'source_fingerprint') !== manifestFingerprint || (!live && num(batch, 'total') !== total))) throw new Error('batch_source_mismatch')
        if (!batch) { batch = new Record(tx.findCollectionByNameOrId('karaoke_catalog_imports')); set(batch, 'batch_key', batchKey); set(batch, 'source_fingerprint', manifestFingerprint); set(batch, 'source_url', sourceUrl); set(batch, 'source_terms', sourceTerms); set(batch, 'status', 'running'); set(batch, 'quota_limit', 10000); set(batch, 'quota_used', 0); set(batch, 'cursor', 0); set(batch, 'total', total); tx.save(batch) }
        let chunk = null; try { chunk = tx.findFirstRecordByFilter('karaoke_catalog_import_chunks', 'import = {:import} && offset = {:offset}', { import: id(batch), offset }) } catch (_) {}
        if (chunk) { if (str(chunk, 'chunk_fingerprint') !== requestFingerprint) throw new Error('chunk_source_mismatch'); throw new Error('chunk_replay') }
        const claimKey = `${batchKey}:${requestFingerprint}`; let claim = null; try { claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: claimKey }) } catch (_) {}
        if (claim && str(claim, 'status') === 'in_progress' && new Date(str(claim, 'lease_expires_at')).getTime() > Date.now()) throw new Error('youtube_request_in_progress')
        if (claim && str(claim, 'status') === 'in_progress') { const oldReserved = num(claim, 'reserved_units'); const oldDay = str(claim, 'quota_day_key'); if (oldReserved && oldDay) { const oldQuota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: oldDay }); set(oldQuota, 'reserved', Math.max(0, num(oldQuota, 'reserved') - oldReserved)); tx.save(oldQuota) } }
        if (claim && ['ready', 'complete'].includes(str(claim, 'status'))) {
          // A persisted payload is authoritative on replay. Reuse its owner so
          // the subsequent chunk commit can complete the claim without turning
          // an already-finished request into a stale-owner failure.
          ownerToken = str(claim, 'owner_token') || ownerToken
          const payload = claim.get ? claim.get('payload_json') : claim.payload_json
          items = payload?.items || []
          total = Number(payload?.total || items.length)
          return
        }
        if (!claim) { claim = new Record(tx.findCollectionByNameOrId('karaoke_youtube_claims')); set(claim, 'claim_key', claimKey); set(claim, 'batch_key', batchKey) }
        // Reclaimed/failed work starts a fresh quota reservation today. Only
        // ready/complete payload replays retain their persisted quota day.
        const quotaDay = dayKey(); set(claim, 'quota_day_key', quotaDay); set(claim, 'status', 'in_progress'); set(claim, 'reserved_units', 303); set(claim, 'owner_token', ownerToken); set(claim, 'lease_expires_at', future(120000)); set(claim, 'error_code', ''); tx.save(claim)
        let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }) } catch (_) {}
        if (!quota) { quota = new Record(tx.findCollectionByNameOrId('karaoke_youtube_quota')); set(quota, 'day_key', quotaDay); set(quota, 'quota_limit', 10000); set(quota, 'reserved', 0); set(quota, 'spent', 0) }
        if (num(quota, 'spent') + num(quota, 'reserved') + 303 > num(quota, 'quota_limit')) throw new Error('youtube_quota_exhausted'); set(quota, 'reserved', num(quota, 'reserved') + 303); tx.save(quota)
      })
      let discovery = null; const existingClaim = find('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (existingClaim && ['ready', 'complete'].includes(str(existingClaim, 'status'))) { const payload = existingClaim.get ? existingClaim.get('payload_json') : existingClaim.payload_json; items = payload?.items || []; total = Number(payload?.total || items.length); discovery = { cost: 0 } } else { discovery = fetchYoutubeCandidates(String(input.query || ''), requestedMaxResults); items = discovery.items; total = items.length }
      const spent = discovery.cost; attemptedCost = spent
      if (!existingClaim || !['ready', 'complete'].includes(str(existingClaim, 'status'))) $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (!claim || str(claim, 'owner_token') !== ownerToken) throw new Error('youtube_claim_stale_owner'); const batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }); const used = num(batch, 'quota_used'); if (used + spent > num(batch, 'quota_limit')) throw new Error('youtube_quota_exhausted'); set(batch, 'quota_used', used + spent); set(batch, 'total', total); set(batch, 'updated_at', now()); tx.save(batch); set(claim, 'payload_json', { items, total, spent }); set(claim, 'spent_units', spent); set(claim, 'status', 'ready'); tx.save(claim); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - num(claim, 'reserved_units'))); set(quota, 'spent', num(quota, 'spent') + spent); tx.save(quota) })
    } catch (error) {
      if (error.message === 'chunk_replay') return c.json(200, { batchKey, imported: 0, replay: true })
      const permanent = ['batch_source_mismatch', 'chunk_source_mismatch', 'youtube_quota_exhausted'].includes(error.message)
      try { $app.runInTransaction((tx) => { const batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }); if (batch) { set(batch, 'status', permanent ? 'failed' : 'paused'); set(batch, 'last_error', String(error.message || 'youtube_import_failed').slice(0, 240)); set(batch, 'updated_at', now()); tx.save(batch) } const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (claim && str(claim, 'owner_token') === ownerToken) { const reserved = num(claim, 'reserved_units'); const consumed = Math.min(reserved, Number(error.quotaCost || attemptedCost || 0)); const qday = str(claim, 'quota_day_key'); if (reserved && qday) { const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: qday }); if (quota) { set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); if (consumed) set(quota, 'spent', num(quota, 'spent') + consumed); tx.save(quota) } } set(claim, 'reserved_units', 0); set(claim, 'spent_units', consumed); set(claim, 'status', 'failed'); set(claim, 'error_code', String(error.message || 'youtube_import_failed')); tx.save(claim) } }) } catch (_) {}
      const code = permanent ? error.message : 'youtube_import_failed'; return json(c, code === 'batch_source_mismatch' || code === 'chunk_source_mismatch' || code === 'youtube_request_in_progress' ? 409 : 503, code, code === 'youtube_quota_exhausted' ? 'YouTube import quota is exhausted' : 'Live YouTube import failed')
    }
  }
  const chunkFingerprint = live ? requestFingerprint : hash(JSON.stringify(canonicalize({ offset, items })))
  let diagnosticStage = 'batch_create'
  try {
    let imported = 0
    $app.runInTransaction((tx) => {
      let batch = null; try { batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }) } catch (_) {}
      // Persist a newly created batch before using its id as the chunk relation.
      // An unsaved PocketBase Record has no id, so the first fixture chunk would
      // otherwise fail relation validation and could not be resumed.
      if (!batch) { batch = new Record(tx.findCollectionByNameOrId('karaoke_catalog_imports')); set(batch, 'batch_key', batchKey); set(batch, 'source_fingerprint', manifestFingerprint); set(batch, 'source_url', String(source.url || '').slice(0, 500)); set(batch, 'source_terms', String(source.terms || '').slice(0, 500)); set(batch, 'source_retrieved_at', String(source.retrievedAt || '')); set(batch, 'status', 'running'); set(batch, 'quota_limit', 10000); set(batch, 'quota_used', 0); set(batch, 'cursor', 0); set(batch, 'total', total); diagnosticStage = 'batch_create'; tx.save(batch) }
      diagnosticStage = 'batch_validate'
      if (str(batch, 'source_fingerprint') !== manifestFingerprint || num(batch, 'total') !== total || str(batch, 'source_url') !== sourceUrl || str(batch, 'source_terms') !== sourceTerms) throw new Error('batch_source_mismatch')
      let chunk = null; try { chunk = tx.findFirstRecordByFilter('karaoke_catalog_import_chunks', 'import = {:import} && offset = {:offset}', { import: id(batch), offset }) } catch (_) {}
      if (chunk && str(chunk, 'chunk_fingerprint') !== chunkFingerprint) throw new Error('chunk_source_mismatch')
      if (chunk) return
      if (offset !== num(batch, 'cursor')) throw new Error('chunk_out_of_order')
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const item = items[itemIndex]
        if (!/^[A-Za-z0-9_-]{11}$/.test(String(item.youtubeId || item.id || ''))) continue
        const youtubeId = String(item.youtubeId || item.id); let song = null
        try { song = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }) } catch (_) {}
        if (song) continue // Existing catalog entries retain operator review and eligibility decisions.
        song = new Record(tx.findCollectionByNameOrId('karaoke_songs'))
        const title = String(item.title || youtubeId).slice(0, 240); const artist = String(item.artist || item.channelTitle || '').slice(0, 160); const result = classifyCatalogItem(item); const normalizedTitle = normalized(title, 240); const normalizedArtist = normalized(artist, 160); set(song, 'youtube_id', youtubeId); set(song, 'title', title); set(song, 'artist', artist); set(song, 'provenance', live ? 'youtube_api_import' : 'fixture_import'); set(song, 'eligibility_reason', result.reason); set(song, 'source', live ? 'youtube' : 'fixture'); set(song, 'source_query', String(input.query || source.terms || '').slice(0, 160)); set(song, 'source_url', sourceUrl); set(song, 'source_retrieved_at', String(source.retrievedAt || now())); set(song, 'source_rank', offset + itemIndex + 1); set(song, 'source_terms', sourceTerms); set(song, 'classification', result.classification); set(song, 'classification_confidence', result.confidence); set(song, 'review_status', 'unreviewed'); set(song, 'eligible', false); set(song, 'normalized_title', normalizedTitle); set(song, 'normalized_artist', normalizedArtist); set(song, 'identity_key', `${normalizedArtist}|${normalizedTitle}`); set(song, 'alternatives_json', []); set(song, 'review_history_json', []); set(song, 'metadata_json', { channelTitle: item.channelTitle || null, description: item.description || null, embeddable: item.embeddable === true, privacyStatus: item.privacyStatus || null, uploadStatus: item.uploadStatus || null, duration: item.duration || null, viewCount: item.viewCount || null }); set(song, 'import_batch', batchKey); set(song, 'imported_at', now()); diagnosticStage = 'song_save'; tx.save(song); imported++
      }
      if (!items.length) { if (live) { const emptyClaim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (emptyClaim && (!str(emptyClaim, 'owner_token') || str(emptyClaim, 'owner_token') === ownerToken)) { set(emptyClaim, 'status', 'complete'); set(emptyClaim, 'reserved_units', 0); tx.save(emptyClaim) } } set(batch, 'cursor', total); set(batch, 'status', 'complete'); set(batch, 'updated_at', now()); diagnosticStage = 'batch_finalize'; tx.save(batch); return }
      chunk = new Record(tx.findCollectionByNameOrId('karaoke_catalog_import_chunks')); set(chunk, 'import', id(batch)); set(chunk, 'offset', offset); set(chunk, 'chunk_fingerprint', chunkFingerprint); set(chunk, 'item_count', items.length); set(chunk, 'payload_json', items); diagnosticStage = 'chunk_save'; tx.save(chunk)
      if (live) { const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (claim && (!str(claim, 'owner_token') || str(claim, 'owner_token') === ownerToken)) { set(claim, 'status', 'complete'); set(claim, 'reserved_units', 0); tx.save(claim) } }
      const cursor = Math.max(num(batch, 'cursor'), offset + items.length); set(batch, 'cursor', cursor); set(batch, 'status', cursor >= total ? 'complete' : 'paused'); set(batch, 'updated_at', now()); diagnosticStage = 'batch_finalize'; tx.save(batch)
    })
    return c.json(200, { batchKey, imported })
  } catch (error) { if (!live) logCatalogImportFailure(diagnosticStage, offset, items.length); const mismatch = ['batch_source_mismatch', 'chunk_source_mismatch', 'chunk_out_of_order'].includes(error.message); const extra = !live ? { failureStage: catalogImportFailureStage(diagnosticStage) } : undefined; return json(c, mismatch ? 409 : 500, mismatch ? error.message : 'import_failed', error.message === 'chunk_out_of_order' ? 'Import chunks must be submitted in order' : mismatch ? 'Import input does not match its original manifest' : 'Catalog import failed', extra) }
})

routerAdd('POST', '/api/karaoke/tablet/catalog/{id}/review', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, id, str, set } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const requestedReviewState = String(input.reviewState || ''); const reviewState = requestedReviewState === 'pending' ? 'unreviewed' : requestedReviewState
  if (!['unreviewed', 'approved', 'rejected', 'needs_review'].includes(reviewState)) return json(c, 422, 'invalid_review', 'Review state is invalid')
  try {
    const song = $app.findRecordById('karaoke_songs', c.request.pathValue('id')); if (!song) return json(c, 404, 'song_not_found', 'Song was not found')
    set(song, 'review_status', reviewState); set(song, 'reviewed_at', now()); set(song, 'reviewed_by', id(auth(c))); if (input.note !== undefined) set(song, 'eligibility_reason', String(input.note).slice(0, 240))
    const classification = str(song, 'classification') || 'unknown'; set(song, 'eligible', reviewState === 'approved' && classification === 'karaoke'); $app.save(song)
    return c.json(200, { id: id(song), reviewState, eligible: song.getBool ? song.getBool('eligible') : false })
  } catch (_) { return json(c, 500, 'review_failed', 'Catalog review failed') }
})

routerAdd('POST', '/api/karaoke/tablet/catalog/{id}/replace', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, id, str, set, YOUTUBE_ID } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const candidateId = String(input.candidateId || ''); const youtubeId = String(input.youtubeId || '')
  if (!candidateId && !YOUTUBE_ID.test(youtubeId)) return json(c, 422, 'invalid_replacement', 'A replacement candidate is required')
  try {
    let song = null; try { song = $app.findRecordById('karaoke_songs', c.request.pathValue('id')) } catch (_) {}
    if (!song) return json(c, 404, 'song_not_found', 'Song was not found')
    let candidate = null; try { candidate = candidateId ? $app.findRecordById('karaoke_songs', candidateId) : $app.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }) } catch (_) {}
    if (!candidate || id(candidate) === id(song)) return json(c, 422, 'invalid_replacement', 'Replacement candidate was not found')
    if (str(candidate, 'classification') !== 'karaoke' || str(candidate, 'review_status') !== 'approved' || !(candidate.getBool ? candidate.getBool('eligible') : false)) return json(c, 409, 'replacement_unavailable', 'Replacement candidate must be approved eligible karaoke')
    set(song, 'replacement_youtube_id', str(candidate, 'youtube_id')); set(song, 'replacement_reason', String(input.reason || 'operator_replacement').slice(0, 240)); set(song, 'eligible', false); $app.save(song)
    return c.json(200, { id: id(song), replacementYoutubeId: str(candidate, 'youtube_id'), eligible: false })
  } catch (_) { return json(c, 500, 'replace_failed', 'Catalog replacement failed') }
})
