// Party lifecycle and fair-rotation queue API. Collection writes remain locked by schema rules.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const PARTY_TTL = 12 * 60 * 60 * 1000
const REQUEST_GAP = 30 * 1000
const JOIN_WINDOW = 60 * 1000
const JOIN_LIMIT = 20
const PARTY_REQUEST_LIMIT = 20
const FALLBACK_QUERY_MAX = 80
const FALLBACK_CANDIDATE_MAX = 5
const FALLBACK_GUEST_LIMIT = 5
const FALLBACK_PARTY_LIMIT = 20
const FALLBACK_POLICY_VERSION = 'v2'
const CONTROLLER_STATE_TTL = 90 * 1000
const joinAttempts = Object.create(null)
const fallbackAttempts = Object.create(null)

function info(c) { try { return c.requestInfo ? c.requestInfo() || {} : $apis.requestInfo(c) || {} } catch (_) { return {} } }
function body(c) { const i = info(c); return i.body && typeof i.body === 'object' ? i.body : i.data && typeof i.data === 'object' ? i.data : {} }
function auth(c) { return info(c).auth || null }
function bearer(c) { const h = info(c).headers || {}; const value = h.authorization || h.Authorization || ''; return String(value).replace(/^Bearer\s+/i, '') }
function query(c, key) { const value = info(c).query?.[key]; return Array.isArray(value) ? value[0] : value }
function now() { return new Date().toISOString() }
// PocketBase normalizes stored datetime fields to "YYYY-MM-DD HH:mm:ss.SSSZ".
// Use the same canonical form for filter parameters: in 0.39.7 an RFC3339
// `T` separator can fail a comparison against a normalized datetime value.
function filterDate(value = new Date()) { return new Date(value).toISOString().replace('T', ' ') }
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
function num(r, f) { return r && r.getFloat ? r.getFloat(f) : r && r.getInt ? r.getInt(f) : Number(r?.[f] || 0) }
function set(r, f, v) { r.set(f, v); return r }
function normalizeJsonValue(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('json_value_invalid_number'); return value }
  if (value === undefined) throw new Error('json_value_undefined')
  if (typeof value !== 'object') throw new Error('json_value_invalid_type')
  const stack = seen || []
  if (stack.includes(value)) throw new Error('json_value_cyclic')
  stack.push(value)
  let out
  if (Array.isArray(value)) out = value.map((entry) => normalizeJsonValue(entry, stack))
  else {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) throw new Error('json_value_wrapper_ambiguous')
    out = {}; Object.keys(value).sort().forEach((key) => { out[key] = normalizeJsonValue(value[key], stack) })
  }
  stack.pop(); return out
}
function serializeJson(value) { return JSON.stringify(normalizeJsonValue(value)) }
// PocketBase 0.39.7 JSON fields must receive the validated native value.
// Assigning a serialized string can persist the Go byte wrapper as a numeric
// array (with a trailing NUL) instead of the intended JSON document.
function setJson(r, f, v) { r.set(f, normalizeJsonValue(v)); return r }
function jsonValue(r, f, fallback) {
  const decode = (text) => {
    let decoded
    try { decoded = JSON.parse(text) }
    catch (error) {
      // Retained PocketBase JSON string scalars can be exposed without their
      // outer quotes while preserving the scalar's backslash escaping.
      if (!/^(?:\{\\"|\[\\")/.test(text)) throw error
      decoded = JSON.parse(`"${text}"`)
    }
    if (typeof decoded === 'string' && /^(?:\[|\{)/.test(decoded.trim())) {
      return JSON.parse(decoded)
    }
    return decoded
  }
  const value = r && r.get ? r.get(f) : r?.[f]
  if (value === null || value === undefined) return fallback
  let stored = ''
  try { stored = r && r.getString ? r.getString(f) : '' } catch (_) {}
  if (stored && /^(?:\[|\{|"|true$|false$|null$|-?\d)/.test(stored.trim())) {
    try { return decode(stored) } catch (_) { return fallback }
  }
  if (typeof value === 'string') { try { return decode(value) } catch (_) { return fallback } }
  // getString above is the only accepted PocketBase JSONRaw wrapper boundary;
  // raw numeric arrays are legitimate JSON and must never be guessed to be
  // encoded bytes merely because they end in zero.
  if (Array.isArray(value)) return value
  if (typeof value === 'object') {
    const text = String(value)
    if (text === '[object Object]') {
      try {
        const serialized = JSON.stringify(value)
        if (/^"(?:\[|\{)/.test(serialized)) return decode(serialized)
      } catch (_) {}
      if (r && r.getString) {
        const raw = r.getString(f)
        if (raw && raw !== text) { try { return decode(raw) } catch (_) {} }
      }
      // A native PocketBase object is already authoritative in-memory state;
      // serialization is enforced by setJson at the persistence boundary.
      return value
    }
    if (!/^(?:\[|\{|\")/.test(text)) return fallback
    try { return decode(text) } catch (_) { return fallback }
  }
  return fallback
}
function requiredJsonValue(r, f) {
  const raw = r && r.get ? r.get(f) : r?.[f]
  if (raw === null || raw === undefined) throw new Error(`json_value_missing_${f}`)
  const invalid = {}; const value = jsonValue(r, f, invalid)
  if (value === invalid) throw new Error(`json_value_malformed_${f}`)
  try { return normalizeJsonValue(value) } catch (error) { throw new Error(`${error.message}_${f}`) }
}
function claimTransitionAllowed(from, to) {
  const allowed = { reserved: ['in_progress', 'failed'], in_progress: ['ready', 'failed'], ready: ['complete', 'ready'], complete: ['complete'], failed: ['in_progress', 'failed'] }
  return Boolean(allowed[String(from || 'reserved')]?.includes(String(to)))
}
function validateClaimReplay(claim, payload, sourceFingerprint, chunkFingerprint) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.items)) {
    try { console.error(`Catalog claim payload shape invalid (type=${typeof payload}, array=${Array.isArray(payload)}, itemsArray=${Array.isArray(payload?.items)})`) } catch (_) {}
    throw new Error('claim_payload_invalid')
  }
  const total = Number(payload.total)
  const spent = Number(payload.spent)
  if (!Number.isInteger(total) || total < 0 || total !== payload.items.length || !Number.isFinite(spent) || spent < 0) {
    try { console.error(`Catalog claim payload invalid (total=${total}, items=${payload.items.length}, spent=${spent})`) } catch (_) {}
    throw new Error('claim_payload_invalid')
  }
  const orderedIdentity = payload.items.map((item) => String(item?.youtubeId || item?.id || ''))
  if (orderedIdentity.some((value) => !value)) throw new Error('claim_order_conflict')
  const digest = hash(serializeJson({ items: payload.items, total, spent }))
  const persistedOrder = requiredJsonValue(claim, 'ordered_identity_json')
  if (str(claim, 'source_fingerprint') !== sourceFingerprint || payload.sourceFingerprint !== sourceFingerprint) throw new Error('claim_source_conflict')
  if (str(claim, 'chunk_fingerprint') !== chunkFingerprint || payload.chunkFingerprint !== chunkFingerprint) throw new Error('claim_chunk_conflict')
  if (str(claim, 'payload_digest') !== digest || payload.payloadDigest !== digest) throw new Error('claim_digest_conflict')
  if (serializeJson(persistedOrder) !== serializeJson(orderedIdentity) || serializeJson(payload.orderedIdentity) !== serializeJson(orderedIdentity)) throw new Error('claim_order_conflict')
  return { items: payload.items, total, spent }
}
function sameInstant(left, right) {
  const canonical = (value) => String(value || '').trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
  const leftText = canonical(left); const rightText = canonical(right)
  if (leftText === rightText) return true
  const leftTime = Date.parse(leftText); const rightTime = Date.parse(rightText)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime
  return false
}
function catalogBatchMismatch(batch, expected, checkTotal) {
  if (str(batch, 'source_fingerprint') !== expected.fingerprint) return 'fingerprint'
  if (str(batch, 'source_url') !== expected.url) return 'url'
  if (str(batch, 'source_terms') !== expected.terms) return 'terms'
  if (!sameInstant(str(batch, 'source_retrieved_at'), expected.retrievedAt)) return 'retrieved_at'
  if (checkTotal && num(batch, 'total') !== expected.total) return 'total'
  return ''
}
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
function canonicalize(v) { return normalizeJsonValue(v) }
function catalogFinalDigest(source, total, items) {
  return hash(JSON.stringify(canonicalize({ source: { url: String(source?.url || ''), terms: String(source?.terms || ''), retrievedAt: String(source?.retrievedAt || '') }, total: Number(total), items: Array.isArray(items) ? items : [] })))
}
function normalized(v, max) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, max) }
function fallbackQuery(v) {
  const value = normalized(v, FALLBACK_QUERY_MAX)
  if (value.length < 2 || value.split(' ').filter(Boolean).length > 12) throw new Error('fallback_query_invalid')
  const tokens = value.split(' ').filter((token) => token && token !== 'karaoke')
  const base = tokens.join(' ')
  if (!base) return 'karaoke'
  const room = Math.max(1, FALLBACK_QUERY_MAX - ' karaoke'.length)
  return `${base.slice(0, room).trim()} karaoke`
}
function catalogSafeSong(song) {
  return { id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist') }
}
function classifyCatalogItem(item) {
  const text = `${item?.videoTitle || item?.title || ''} ${item?.description || ''} ${item?.channelTitle || ''}`.toLowerCase()
  if (/\b(live|concert|performance)\b/.test(text)) return { classification: 'live', confidence: 0.98, reason: 'live_performance' }
  if (/\bkaraoke\b|backing track|instrumental/.test(text)) return { classification: 'karaoke', confidence: /\bkaraoke\b/.test(text) ? 0.92 : 0.75, reason: 'karaoke_backing_signal' }
  if (/\baudio only\b|\bofficial audio\b/.test(text)) return { classification: 'fallback_audio', confidence: 0.86, reason: 'audio_fallback_signal' }
  if (/\blyrics?\b|lyric video/.test(text)) return { classification: 'fallback_lyric', confidence: 0.9, reason: 'lyric_fallback_signal' }
  if (/\bcover\b/.test(text)) return { classification: 'cover', confidence: 0.8, reason: 'cover_signal' }
  if (/\bofficial\b|music video/.test(text)) return { classification: 'original', confidence: 0.85, reason: 'original_signal' }
  return { classification: 'unknown', confidence: 0.25, reason: 'insufficient_metadata' }
}
function recordYoutubeOperation(tx, operationClass, sourceKey, snapshotFingerprint, modeledUnits, observedCalls) {
  let operation = null
  try { operation = tx.findFirstRecordByFilter('karaoke_youtube_operations', 'day_key = {:day} && operation_class = {:operation} && source_key = {:source} && snapshot_fingerprint = {:fingerprint}', { day: dayKey(), operation: operationClass, source: sourceKey, fingerprint: snapshotFingerprint }) } catch (_) {}
  if (!operation) { operation = new Record(tx.findCollectionByNameOrId('karaoke_youtube_operations')); set(operation, 'day_key', dayKey()); set(operation, 'operation_class', operationClass); set(operation, 'source_key', sourceKey); set(operation, 'snapshot_fingerprint', snapshotFingerprint); set(operation, 'modeled_units', 0); set(operation, 'observed_calls', 0) }
  set(operation, 'modeled_units', num(operation, 'modeled_units') + Math.max(0, Number(modeledUnits) || 0)); set(operation, 'observed_calls', num(operation, 'observed_calls') + Math.max(0, Number(observedCalls) || 0)); tx.save(operation)
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
    // The canonical JSON boundary rejects undefined. Optional external values
    // are represented explicitly; classification is derived only after the
    // authoritative response has been persisted.
    return { youtubeId, videoTitle: snippet.title || youtubeId, description: snippet.description || '', channelTitle: snippet.channelTitle || '', channelId: snippet.channelId || '', classification: null, embeddable: status.embeddable === true, privacyStatus: status.privacyStatus || 'unknown', uploadStatus: status.uploadStatus || 'unknown', duration: item?.contentDetails?.duration || '', viewCount: item?.statistics?.viewCount || '', candidateRank: index + 1 }
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
function songView(q, song) {
  const missingFallbackIdentity = str(song, 'provenance') === 'youtube_fallback' && (str(song, 'identity_status') || 'missing') === 'missing'
  const fallbackTitle = str(song, 'video_title') || str(song, 'title') || str(song, 'youtube_id')
  const channel = str(song, 'video_channel_title')
  return { id: id(q), sequence: num(q, 'sequence'), status: str(q, 'status'), requestedAt: str(q, 'requested_at'), song: { id: id(song), youtubeId: str(song, 'youtube_id'), title: missingFallbackIdentity ? fallbackTitle : str(song, 'title'), artist: missingFallbackIdentity ? (channel ? `YouTube fallback · ${channel}` : 'YouTube fallback') : str(song, 'artist') } }
}

// The tablet may see a friendly anonymous requester label and the exact
// fair-rotation projection, but never a guest credential or raw guest record.
function tabletQueueView(rows) {
  const labels = Object.create(null)
  for (const row of rows.slice().sort((a, b) => num(a, 'sequence') - num(b, 'sequence'))) {
    const requester = str(row, 'requester')
    if (!labels[requester]) labels[requester] = `Guest ${Object.keys(labels).length + 1}`
  }
  const decorate = (row, fairPosition) => ({
    ...songView(row, $app.findRecordById('karaoke_songs', str(row, 'song'))),
    requesterLabel: labels[str(row, 'requester')] || 'Guest',
    ...(fairPosition ? { fairPosition } : {}),
  })
  const playing = rows.filter((row) => str(row, 'status') === 'playing').map((row) => decorate(row))
  const remaining = rows.filter((row) => str(row, 'status') === 'queued')
  const served = Object.create(null)
  for (const row of remaining) {
    const guest = find('karaoke_guest_identities', 'id = {:id}', { id: str(row, 'requester') })
    served[str(row, 'requester')] = guest && str(guest, 'last_served_at') ? new Date(str(guest, 'last_served_at')).getTime() : 0
  }
  let nextServedAt = Math.max(Date.now(), ...Object.values(served).map(Number)) + 1
  const fair = []
  while (remaining.length) {
    const first = Object.create(null)
    for (const row of remaining.slice().sort((a, b) => num(a, 'sequence') - num(b, 'sequence'))) {
      const requester = str(row, 'requester'); if (!first[requester]) first[requester] = row
    }
    const choice = Object.values(first).sort((a, b) => served[str(a, 'requester')] - served[str(b, 'requester')] || num(a, 'sequence') - num(b, 'sequence') || String(str(a, 'requester')).localeCompare(String(str(b, 'requester'))))[0]
    fair.push(choice); served[str(choice, 'requester')] = nextServedAt++
    remaining.splice(remaining.findIndex((row) => id(row) === id(choice)), 1)
  }
  return [...playing, ...fair.map((row, index) => decorate(row, index + 1))]
}

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

globalThis.__partyQueue = { CODE_ALPHABET, YOUTUBE_ID, PARTY_TTL, REQUEST_GAP, JOIN_WINDOW, JOIN_LIMIT, PARTY_REQUEST_LIMIT, FALLBACK_QUERY_MAX, FALLBACK_CANDIDATE_MAX, FALLBACK_GUEST_LIMIT, FALLBACK_POLICY_VERSION, CONTROLLER_STATE_TTL, joinAttempts, fallbackAttempts, info, body, auth, bearer, query, requireGuest, activeParty, tablet, hash, normalizeJsonValue, serializeJson, canonicalize, catalogFinalDigest, normalized, fallbackQuery, catalogSafeSong, classifyCatalogItem, recordYoutubeOperation, env, youtubeRequest, fetchYoutubeCandidates, random, code, now, filterDate, future, dayKey, str, num, set, setJson, jsonValue, requiredJsonValue, claimTransitionAllowed, validateClaimReplay, sameInstant, catalogBatchMismatch, id, json, songView, tabletQueueView, tabletControllerView, find, records, chooseNext, catalogImportFailureStage, logCatalogImportFailure, catalogCheckpointHealth }
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
  const { PARTY_TTL, CONTROLLER_STATE_TTL, auth, tablet, json, find, code, hash, set, future, filterDate, id, str } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  let result
  try {
    $app.runInTransaction((tx) => {
      let plain; let party
      for (let i = 0; i < 8; i++) { plain = code(); if (!find('karaoke_parties', 'code_hash = {:hash}', { hash: hash(plain) })) break }
      party = new Record(tx.findCollectionByNameOrId('karaoke_parties'))
      const controllers = tx.findRecordsByFilter('controller_devices', 'revoked = false && last_seen_at > {:cutoff}', '-last_seen_at', 2, 0, { cutoff: filterDate(Date.now() - CONTROLLER_STATE_TTL) })
      set(party, 'code_hash', hash(plain)); set(party, 'code_hint', plain.slice(-4)); set(party, 'status', 'active'); set(party, 'expires_at', future(PARTY_TTL)); set(party, 'created_by', id(auth(c))); set(party, 'join_count', 0)
      // Never guess between multiple enrolled devices. A single retained,
      // non-revoked controller can safely become the party controller.
      if (controllers.length === 1) set(party, 'controller_device', id(controllers[0]))
      tx.save(party)
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

// Compact versioned index for client-side search. Only approved/eligible
// canonical fields cross the party credential boundary.
routerAdd('GET', '/api/karaoke/parties/catalog', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { requireGuest, records, str, id, hash, json } = globalThis.__partyQueue
  try {
    requireGuest(c, {})
    const rows = records('karaoke_songs', 'eligible = true && review_status = "approved"', '+normalized_title,+normalized_artist,+youtube_id', 5000, 0)
    const songs = rows.map((song) => ({ id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist') }))
    const version = hash(songs.map((song) => `${song.youtubeId}|${song.title}|${song.artist}`).join('\n')).slice(0, 32)
    return c.json(200, { version, songs })
  } catch (error) {
    const status = ['party_expired', 'guest_credential_expired'].includes(error.message) ? 410 : 403
    return json(c, status, error.message, 'Catalog access denied')
  }
})

// Explicit party-scoped YouTube fallback. Results are cached durably by the
// normalized query; candidates remain ineligible globally and are requestable
// only through the authenticated party path below.
routerAdd('POST', '/api/karaoke/parties/songs/fallback', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { requireGuest, body, fallbackQuery, FALLBACK_CANDIDATE_MAX, FALLBACK_GUEST_LIMIT, FALLBACK_PARTY_LIMIT, FALLBACK_POLICY_VERSION, json, id, str, now, future, set, setJson, num, random, dayKey, fetchYoutubeCandidates, classifyCatalogItem, hash } = globalThis.__partyQueue
  let access
  try { access = requireGuest(c, {}) } catch (error) { return json(c, ['party_expired', 'guest_credential_expired'].includes(error.message) ? 410 : 403, error.message, 'Fallback search denied') }
  let normalizedQuery
  try { normalizedQuery = fallbackQuery(body(c).query) } catch (error) { return json(c, 422, error.message, 'A bounded search query is required') }
  const queryHash = hash(normalizedQuery); const ownerToken = random(32); const quotaDay = dayKey(); let ownsClaim = false; let externalCall = false; let quotaReserved = false
  try {
    let replay = false; let payload = null
    $app.runInTransaction((tx) => {
      let claim = null; try { claim = tx.findFirstRecordByFilter('karaoke_youtube_search_claims', 'query_hash = {:hash} && policy_version = {:policy}', { hash: queryHash, policy: FALLBACK_POLICY_VERSION }) } catch (_) {}
      if (claim && str(claim, 'status') === 'ready' && new Date(str(claim, 'expires_at')).getTime() > Date.now() && Array.isArray(globalThis.__partyQueue.jsonValue(claim, 'payload_json', null))) { payload = globalThis.__partyQueue.jsonValue(claim, 'payload_json', []); replay = true; return }
      if (claim && str(claim, 'status') === 'in_progress' && new Date(str(claim, 'lease_expires_at')).getTime() > Date.now()) throw new Error('fallback_in_progress')
      if (claim && str(claim, 'status') === 'in_progress') { const oldReserved = num(claim, 'reserved_units'); const oldDay = str(claim, 'quota_day_key'); const conservativeSpent = Boolean(str(claim, 'external_started_at')); if (oldReserved && oldDay) { const oldQuota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: oldDay }); set(oldQuota, 'reserved', Math.max(0, num(oldQuota, 'reserved') - oldReserved)); if (conservativeSpent) set(oldQuota, 'spent', num(oldQuota, 'spent') + oldReserved); tx.save(oldQuota) } if (conservativeSpent) set(claim, 'spent_units', num(claim, 'spent_units') + oldReserved); set(claim, 'reserved_units', 0); set(claim, 'status', 'failed'); tx.save(claim) }
      let limit = null; try { limit = tx.findFirstRecordByFilter('karaoke_fallback_rate_limits', 'party = {:party} && guest = {:guest} && day_key = {:day}', { party: id(access.party), guest: id(access.guest), day: quotaDay }) } catch (_) {}
      if (!limit) { limit = new Record(tx.findCollectionByNameOrId('karaoke_fallback_rate_limits')); set(limit, 'party', id(access.party)); set(limit, 'guest', id(access.guest)); set(limit, 'day_key', quotaDay); set(limit, 'count', 0) }
      const partyLimits = tx.findRecordsByFilter('karaoke_fallback_rate_limits', 'party = {:party} && day_key = {:day}', '', 1000, 0, { party: id(access.party), day: quotaDay }); const partyCount = partyLimits.reduce((total, row) => total + num(row, 'count'), 0)
      if (num(limit, 'count') >= FALLBACK_GUEST_LIMIT || partyCount >= FALLBACK_PARTY_LIMIT) throw new Error('fallback_rate_limited')
      let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }) } catch (_) {} if (!quota) { quota = new Record(tx.findCollectionByNameOrId('karaoke_youtube_quota')); set(quota, 'day_key', quotaDay); set(quota, 'quota_limit', 10000); set(quota, 'reserved', 0); set(quota, 'spent', 0) } if (num(quota, 'spent') + num(quota, 'reserved') + 101 > num(quota, 'quota_limit')) throw new Error('youtube_quota_exhausted')
      if (!claim) { claim = new Record(tx.findCollectionByNameOrId('karaoke_youtube_search_claims')); set(claim, 'query_hash', queryHash); set(claim, 'policy_version', FALLBACK_POLICY_VERSION) } set(claim, 'status', 'in_progress'); set(claim, 'owner_token', ownerToken); set(claim, 'lease_expires_at', future(120000)); set(claim, 'reserved_units', 101); set(claim, 'quota_day_key', quotaDay); set(claim, 'external_started_at', null); tx.save(claim); set(limit, 'count', num(limit, 'count') + 1); tx.save(limit); set(quota, 'reserved', num(quota, 'reserved') + 101); tx.save(quota); ownsClaim = true; quotaReserved = true
    })
    if (replay) { $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_youtube_search_claims', 'query_hash = {:hash} && policy_version = {:policy}', { hash: queryHash, policy: FALLBACK_POLICY_VERSION }); let grant = null; try { grant = tx.findFirstRecordByFilter('karaoke_youtube_search_access', 'party = {:party} && guest = {:guest} && claim = {:claim}', { party: id(access.party), guest: id(access.guest), claim: id(claim) }) } catch (_) {} if (!grant) { grant = new Record(tx.findCollectionByNameOrId('karaoke_youtube_search_access')); set(grant, 'party', id(access.party)); set(grant, 'guest', id(access.guest)); set(grant, 'claim', id(claim)) } set(grant, 'expires_at', future(24 * 60 * 60 * 1000)); tx.save(grant) }); return c.json(200, { query: normalizedQuery, replay: true, candidates: payload.map((candidate) => ({ youtubeId: candidate.youtubeId, title: candidate.title, channelTitle: candidate.channelTitle || '', channelId: candidate.channelId || '', classification: candidate.classification, confidence: candidate.confidence, reason: candidate.reason })) }) }
    $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_youtube_search_claims', 'query_hash = {:hash} && policy_version = {:policy}', { hash: queryHash, policy: FALLBACK_POLICY_VERSION }); if (str(claim, 'owner_token') !== ownerToken) throw new Error('fallback_claim_stale'); set(claim, 'external_started_at', now()); tx.save(claim) }); externalCall = true; const discovered = fetchYoutubeCandidates(normalizedQuery, FALLBACK_CANDIDATE_MAX); const candidates = discovered.items.map((item) => { const result = classifyCatalogItem(item); return { youtubeId: item.youtubeId, title: String(item.videoTitle || '').slice(0, 240), channelTitle: String(item.channelTitle || '').slice(0, 240), channelId: String(item.channelId || '').slice(0, 120), classification: result.classification, confidence: result.confidence, reason: result.reason } }).filter((item) => item.classification === 'karaoke' && item.confidence >= 0.8).slice(0, FALLBACK_CANDIDATE_MAX)
    $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_youtube_search_claims', 'query_hash = {:hash} && policy_version = {:policy}', { hash: queryHash, policy: FALLBACK_POLICY_VERSION }); if (str(claim, 'owner_token') !== ownerToken) throw new Error('fallback_claim_stale'); setJson(claim, 'payload_json', candidates); set(claim, 'status', 'ready'); set(claim, 'expires_at', future(24 * 60 * 60 * 1000)); set(claim, 'spent_units', num(claim, 'spent_units') + 101); set(claim, 'reserved_units', 0); tx.save(claim); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - 101)); set(quota, 'spent', num(quota, 'spent') + 101); tx.save(quota); let grant = null; try { grant = tx.findFirstRecordByFilter('karaoke_youtube_search_access', 'party = {:party} && guest = {:guest} && claim = {:claim}', { party: id(access.party), guest: id(access.guest), claim: id(claim) }) } catch (_) {} if (!grant) { grant = new Record(tx.findCollectionByNameOrId('karaoke_youtube_search_access')); set(grant, 'party', id(access.party)); set(grant, 'guest', id(access.guest)); set(grant, 'claim', id(claim)) } set(grant, 'expires_at', future(24 * 60 * 60 * 1000)); tx.save(grant) })
    quotaReserved = false; return c.json(200, { query: normalizedQuery, replay: false, candidates })
  } catch (error) {
    try { if (quotaReserved) $app.runInTransaction((tx) => { const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - 101)); if (externalCall) set(quota, 'spent', num(quota, 'spent') + 101); tx.save(quota); const claim = tx.findFirstRecordByFilter('karaoke_youtube_search_claims', 'query_hash = {:hash} && policy_version = {:policy}', { hash: queryHash, policy: FALLBACK_POLICY_VERSION }); if (claim && str(claim, 'owner_token') === ownerToken) { set(claim, 'status', 'failed'); set(claim, 'reserved_units', 0); if (externalCall) set(claim, 'spent_units', num(claim, 'spent_units') + 101); tx.save(claim) } }) } catch (_) {}
    const reason = String(error.message || ''); const code = reason === 'fallback_in_progress' ? 'fallback_in_progress' : reason === 'fallback_rate_limited' ? 'fallback_rate_limited' : reason === 'youtube_quota_exhausted' ? 'fallback_quota_exhausted' : 'fallback_unavailable'; return json(c, code === 'fallback_in_progress' ? 409 : code.includes('rate') || code.includes('quota') ? 429 : 503, code, code === 'fallback_in_progress' ? 'Fallback search is already in progress' : 'Fallback search is temporarily unavailable')
  }
})

routerAdd('POST', '/api/karaoke/parties/songs/fallback/request', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const q = globalThis.__partyQueue; let access
  try { access = q.requireGuest(c, {}) } catch (error) { return q.json(c, 403, error.message, 'Fallback request denied') }
  const input = q.body(c); const youtubeId = String(input.youtubeId || ''); const requestKey = String(input.idempotencyKey || '').slice(0, 96)
  if (!q.YOUTUBE_ID.test(youtubeId) || !requestKey) return q.json(c, 422, 'invalid_fallback_request', 'Candidate and idempotency key are required')
  try {
    let result
    $app.runInTransaction((tx) => {
      const party = tx.findRecordById('karaoke_parties', q.id(access.party)); const guest = tx.findRecordById('karaoke_guest_identities', q.id(access.guest)); if (!q.activeParty(party)) throw new Error('party_expired')
      let prior = null; try { prior = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && requester = {:requester} && request_key = {:key}', { party: q.id(party), requester: q.id(guest), key: requestKey }) } catch (_) {} if (prior) { result = q.songView(prior, tx.findRecordById('karaoke_songs', q.str(prior, 'song'))); return }
      const grants = tx.findRecordsByFilter('karaoke_youtube_search_access', 'party = {:party} && guest = {:guest} && expires_at > {:now}', '-expires_at', 100, 0, { party: q.id(party), guest: q.id(guest), now: q.now() }); let candidate = null; for (const grant of grants) { const claim = tx.findRecordById('karaoke_youtube_search_claims', q.str(grant, 'claim')); const payload = claim ? q.jsonValue(claim, 'payload_json', []) : []; if (Array.isArray(payload)) { candidate = payload.find((item) => String(item.youtubeId) === youtubeId && item.classification === 'karaoke' && Number(item.confidence) >= 0.8); if (candidate) break } } if (!candidate) throw new Error('fallback_candidate_unavailable')
      if (q.str(guest, 'last_request_at') && Date.now() - new Date(q.str(guest, 'last_request_at')).getTime() < q.REQUEST_GAP) throw new Error('rate_limited'); const recent = tx.findRecordsByFilter('karaoke_queue', 'party = {:party} && requested_at >= {:cutoff}', '', q.PARTY_REQUEST_LIMIT + 1, 0, { party: q.id(party), cutoff: new Date(Date.now() - q.REQUEST_GAP).toISOString() }); if (recent.length >= q.PARTY_REQUEST_LIMIT) throw new Error('rate_limited')
      let song = null; try { song = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }) } catch (_) {}
      if (!song) { song = new Record(tx.findCollectionByNameOrId('karaoke_songs')); q.set(song, 'youtube_id', youtubeId); q.set(song, 'title', 'Unidentified karaoke candidate'); q.set(song, 'artist', 'Unidentified artist'); q.set(song, 'eligible', false); q.set(song, 'classification', 'karaoke'); q.set(song, 'classification_confidence', Number(candidate.confidence)); q.set(song, 'review_status', 'needs_review'); q.set(song, 'provenance', 'youtube_fallback'); q.set(song, 'eligibility_reason', 'missing_canonical_identity'); q.set(song, 'identity_status', 'missing'); q.set(song, 'identity_reason', 'missing_canonical_identity'); q.set(song, 'video_title', String(candidate.title || '').slice(0, 500)); q.set(song, 'video_channel_title', String(candidate.channelTitle || '').slice(0, 240)); q.set(song, 'video_channel_id', String(candidate.channelId || '').slice(0, 120)); tx.save(song) } else if (q.str(song, 'provenance') === 'youtube_fallback' && (q.str(song, 'identity_status') || 'missing') === 'missing') { if (!q.str(song, 'video_title') && candidate.title) q.set(song, 'video_title', String(candidate.title).slice(0, 500)); if (!q.str(song, 'video_channel_title') && candidate.channelTitle) q.set(song, 'video_channel_title', String(candidate.channelTitle).slice(0, 240)); if (!q.str(song, 'video_channel_id') && candidate.channelId) q.set(song, 'video_channel_id', String(candidate.channelId).slice(0, 120)); tx.save(song) }
      let duplicate = null; try { duplicate = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && active_song_key = {:key}', { party: q.id(party), key: youtubeId }) } catch (_) {} if (duplicate) throw new Error('duplicate_song')
      const sequence = q.num(party, 'queue_sequence') + 1; q.set(party, 'queue_sequence', sequence); tx.save(party); const queue = new Record(tx.findCollectionByNameOrId('karaoke_queue')); q.set(queue, 'party', q.id(party)); q.set(queue, 'song', q.id(song)); q.set(queue, 'requester', q.id(guest)); q.set(queue, 'status', 'queued'); q.set(queue, 'active_song_key', youtubeId); q.set(queue, 'request_key', requestKey); q.set(queue, 'sequence', sequence); q.set(queue, 'requested_at', q.now()); tx.save(queue); q.set(guest, 'last_request_at', q.now()); q.set(guest, 'request_count', q.num(guest, 'request_count') + 1); tx.save(guest); result = q.songView(queue, song)
    })
    return c.json(201, result)
  } catch (error) {
    const reason = String(error && error.message || error)
    if (reason.toLowerCase().includes('unique')) {
      try {
        let replay = null
        $app.runInTransaction((tx) => { const queue = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && requester = {:requester} && request_key = {:key}', { party: q.id(access.party), requester: q.id(access.guest), key: requestKey }); replay = q.songView(queue, tx.findRecordById('karaoke_songs', q.str(queue, 'song'))) })
        if (replay) return c.json(200, replay)
      } catch (_) {}
      let retryError = null
      try {
        let retry = null; let replayed = false
        $app.runInTransaction((tx) => {
          const party = tx.findRecordById('karaoke_parties', q.id(access.party)); const guest = tx.findRecordById('karaoke_guest_identities', q.id(access.guest)); if (!q.activeParty(party)) throw new Error('party_expired')
          let prior = null; try { prior = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && requester = {:requester} && request_key = {:key}', { party: q.id(party), requester: q.id(guest), key: requestKey }) } catch (_) {} if (prior) { retry = q.songView(prior, tx.findRecordById('karaoke_songs', q.str(prior, 'song'))); replayed = true; return }
          const grants = tx.findRecordsByFilter('karaoke_youtube_search_access', 'party = {:party} && guest = {:guest} && expires_at > {:now}', '-expires_at', 100, 0, { party: q.id(party), guest: q.id(guest), now: q.now() }); let candidate = null; for (const grant of grants) { const claim = tx.findRecordById('karaoke_youtube_search_claims', q.str(grant, 'claim')); const payload = claim ? q.jsonValue(claim, 'payload_json', []) : []; if (Array.isArray(payload)) { candidate = payload.find((item) => String(item.youtubeId) === youtubeId && item.classification === 'karaoke' && Number(item.confidence) >= 0.8); if (candidate) break } } if (!candidate) throw new Error('fallback_candidate_unavailable')
          if (q.str(guest, 'last_request_at') && Date.now() - new Date(q.str(guest, 'last_request_at')).getTime() < q.REQUEST_GAP) throw new Error('rate_limited'); const recent = tx.findRecordsByFilter('karaoke_queue', 'party = {:party} && requested_at >= {:cutoff}', '', q.PARTY_REQUEST_LIMIT + 1, 0, { party: q.id(party), cutoff: new Date(Date.now() - q.REQUEST_GAP).toISOString() }); if (recent.length >= q.PARTY_REQUEST_LIMIT) throw new Error('rate_limited')
          const song = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }); if (q.str(song, 'provenance') === 'youtube_fallback' && (q.str(song, 'identity_status') || 'missing') === 'missing') { if (!q.str(song, 'video_title') && candidate.title) q.set(song, 'video_title', String(candidate.title).slice(0, 500)); if (!q.str(song, 'video_channel_title') && candidate.channelTitle) q.set(song, 'video_channel_title', String(candidate.channelTitle).slice(0, 240)); if (!q.str(song, 'video_channel_id') && candidate.channelId) q.set(song, 'video_channel_id', String(candidate.channelId).slice(0, 120)); tx.save(song) } let duplicate = null; try { duplicate = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && active_song_key = {:key}', { party: q.id(party), key: youtubeId }) } catch (_) {} if (duplicate) throw new Error('duplicate_song')
          const sequence = q.num(party, 'queue_sequence') + 1; q.set(party, 'queue_sequence', sequence); tx.save(party); const queue = new Record(tx.findCollectionByNameOrId('karaoke_queue')); q.set(queue, 'party', q.id(party)); q.set(queue, 'song', q.id(song)); q.set(queue, 'requester', q.id(guest)); q.set(queue, 'status', 'queued'); q.set(queue, 'active_song_key', youtubeId); q.set(queue, 'request_key', requestKey); q.set(queue, 'sequence', sequence); q.set(queue, 'requested_at', q.now()); tx.save(queue); q.set(guest, 'last_request_at', q.now()); q.set(guest, 'request_count', q.num(guest, 'request_count') + 1); tx.save(guest); retry = q.songView(queue, song)
        })
        if (retry) return c.json(replayed ? 200 : 201, retry)
      } catch (error) { retryError = error }
      const retryReason = String(retryError && retryError.message || '')
      if (['party_expired', 'fallback_candidate_unavailable', 'rate_limited'].includes(retryReason)) return q.json(c, { party_expired: 410, fallback_candidate_unavailable: 422, rate_limited: 429 }[retryReason], retryReason, 'Fallback request rejected')
      return q.json(c, 409, 'duplicate_song', 'Song is already queued')
    }
    const status = { party_expired: 410, duplicate_song: 409, fallback_candidate_unavailable: 422, rate_limited: 429 }[reason] || 500; return q.json(c, status, reason, 'Fallback request rejected')
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
  const { auth, tablet, json, info, find, records, id, str, tabletQueueView, tabletControllerView } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const partyId = info(c).query?.partyId
  if (Array.isArray(partyId) ? !partyId[0] : !partyId) return json(c, 400, 'invalid_party', 'partyId is required')
  const party = find('karaoke_parties', 'id = {:id}', { id: Array.isArray(partyId) ? partyId[0] : partyId })
  if (!party) return json(c, 404, 'party_not_found', 'Party was not found')
  const rows = records('karaoke_queue', 'party = {:party} && (status = "queued" || status = "playing")', '+sequence', 200, { party: id(party) })
  const queue = tabletQueueView(rows)
  return c.json(200, {
    party: { id: id(party), status: str(party, 'status'), expiresAt: str(party, 'expires_at'), codeHint: str(party, 'code_hint'), joinCount: Number(party.join_count || 0) || (party.getInt ? party.getInt('join_count') : 0) },
    queue,
    controller: tabletControllerView(party),
  })
})

// A party created before a retained controller was available can be repaired
// without exposing controller records or guessing between multiple devices.
routerAdd('POST', '/api/karaoke/tablet/controller/bind', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, id, str, set, filterDate, CONTROLLER_STATE_TTL } = globalThis.__partyQueue
  const operator = auth(c)
  if (!tablet(operator)) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const partyId = String(body(c).partyId || '')
  if (!partyId) return json(c, 422, 'party_required', 'An active party is required')
  try {
    let deviceId = ''
    $app.runInTransaction((tx) => {
      const party = tx.findRecordById('karaoke_parties', partyId)
      if (!party || str(party, 'created_by') !== id(operator)) throw new Error('party_not_found')
      deviceId = str(party, 'controller_device')
      if (deviceId) return
      const controllers = tx.findRecordsByFilter('controller_devices', 'revoked = false && last_seen_at > {:cutoff}', '-last_seen_at', 2, 0, { cutoff: filterDate(Date.now() - CONTROLLER_STATE_TTL) })
      if (controllers.length !== 1) throw new Error(controllers.length ? 'controller_ambiguous' : 'controller_unavailable')
      deviceId = id(controllers[0]); set(party, 'controller_device', deviceId); tx.save(party)
    })
    return c.json(200, { partyId, bound: Boolean(deviceId) })
  } catch (error) {
    const code = String(error.message || 'controller_bind_failed')
    const message = code === 'controller_ambiguous' ? 'More than one current controller is available' : code === 'controller_unavailable' ? 'No current controller is available' : 'Controller binding is unavailable'
    return json(c, code === 'party_not_found' ? 404 : 409, code, message)
  }
})

// Reload recovery for a tablet account.  Party codes are intentionally not
// recoverable from their stored hash, so this returns only the safe hint.
routerAdd('GET', '/api/karaoke/tablet/active', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, records, id, str, now } = globalThis.__partyQueue
  const operator = auth(c)
  if (!tablet(operator)) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const active = records('karaoke_parties', 'created_by = {:operator} && status = "active" && expires_at > {:now}', '-expires_at', 1, { operator: id(operator), now: now() })[0] || null
  if (!active) return c.json(200, { party: null })
  return c.json(200, { party: { id: id(active), codeHint: str(active, 'code_hint'), expiresAt: str(active, 'expires_at'), status: str(active, 'status') } })
})

// Party-scoped transport controls. The browser never receives a controller
// credential or chooses a device; it may only control the current video owned
// by its active party through the bound, fresh controller session.
routerAdd('POST', '/api/karaoke/tablet/controller/playback', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, str, id, set, setJson, num, future, activeParty, CONTROLLER_STATE_TTL } = globalThis.__partyQueue
  const operator = auth(c)
  if (!tablet(operator)) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c)
  const partyId = String(input.partyId || '')
  const action = String(input.action || '')
  const idempotencyKey = String(input.idempotencyKey || '')
  if (!partyId || !['play', 'pause'].includes(action)) return json(c, 422, 'invalid_playback_action', 'Party and play or pause action are required')
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json(c, 422, 'invalid_idempotency_key', 'Playback idempotency key is invalid')
  try {
    let result
    $app.runInTransaction((tx) => {
      const party = tx.findRecordById('karaoke_parties', partyId)
      if (!party || str(party, 'created_by') !== id(operator)) throw new Error('party_not_found')
      if (!activeParty(party)) throw new Error('party_expired')
      let playing = null
      try { playing = tx.findFirstRecordByFilter('karaoke_queue', 'party = {:party} && status = "playing"', { party: partyId }) } catch (_) {}
      if (!playing) throw new Error('nothing_playing')

      const deviceId = str(party, 'controller_device')
      const expectedKeyPrefix = `tablet:${partyId}:${id(playing)}:${action}:`
      if (!idempotencyKey.startsWith(expectedKeyPrefix)) throw new Error('invalid_idempotency_scope')
      let device = null
      try { device = deviceId ? tx.findRecordById('controller_devices', deviceId) : null } catch (_) {}
      const revoked = device && (device.getBool ? device.getBool('revoked') : Boolean(device.revoked))
      const generation = device ? num(device, 'session_generation') : 0
      let session = null
      let controllerState = null
      if (device && !revoked && generation > 0) {
        try {
          const sessions = tx.findRecordsByFilter('controller_sessions', 'device = {:device} && generation = {:generation}', '-expires_at', 5, 0, { device: deviceId, generation })
          session = sessions.find((candidate) => new Date(str(candidate, 'expires_at')).getTime() > Date.now()) || null
          controllerState = tx.findFirstRecordByFilter('controller_state', 'device = {:device}', { device: deviceId })
        } catch (_) {}
      }

      // Resolve an exact durable replay before consulting volatile playback
      // state. This prevents an ambiguous client retry from creating a second
      // command merely because the first command already changed that state.
      let duplicate = null
      try { duplicate = deviceId ? tx.findFirstRecordByFilter('controller_commands', 'device = {:device} && idempotency_key = {:key}', { device: deviceId, key: idempotencyKey }) : null } catch (_) {}
      if (duplicate) {
        if (str(duplicate, 'action') !== action || str(duplicate, 'issued_by') !== id(operator)) throw new Error('idempotency_conflict')
        result = { id: id(duplicate), action, sequence: num(duplicate, 'sequence'), status: str(duplicate, 'status'), idempotent: true }
        return
      }

      const stateFresh = controllerState && str(controllerState, 'observed_at') && new Date(str(controllerState, 'observed_at')).getTime() > Date.now() - CONTROLLER_STATE_TTL
      if (!session || !controllerState || !stateFresh || num(controllerState, 'session_generation') !== generation || str(controllerState, 'connection_state') !== 'connected') throw new Error('controller_unavailable')
      const song = tx.findRecordById('karaoke_songs', str(playing, 'song'))
      if (!song || str(controllerState, 'video_id') !== str(song, 'youtube_id')) throw new Error('controller_state_mismatch')
      const playerState = str(controllerState, 'player_state')
      if ((action === 'play' && playerState !== 'paused') || (action === 'pause' && playerState !== 'playing')) throw new Error('playback_state_conflict')
      let equivalentPending = null
      try {
        const pendingCommands = tx.findRecordsByFilter('controller_commands', 'device = {:device} && issued_by = {:operator} && action = {:action} && status = "pending"', '-sequence', 20, 0, { device: deviceId, operator: id(operator), action })
        equivalentPending = pendingCommands.find((candidate) => str(candidate, 'idempotency_key').startsWith(expectedKeyPrefix)) || null
      } catch (_) {}
      if (equivalentPending) {
        result = { id: id(equivalentPending), action, sequence: num(equivalentPending, 'sequence'), status: str(equivalentPending, 'status'), idempotent: true }
        return
      }

      const sequence = num(device, 'command_sequence') + 1
      set(device, 'command_sequence', sequence)
      tx.save(device)
      const command = new Record(tx.findCollectionByNameOrId('controller_commands'))
      set(command, 'device', deviceId)
      set(command, 'session_generation', generation)
      set(command, 'sequence', sequence)
      set(command, 'idempotency_key', idempotencyKey)
      set(command, 'action', action)
      setJson(command, 'payload', {})
      set(command, 'expires_at', future(30000))
      set(command, 'status', 'pending')
      set(command, 'issued_by', id(operator))
      tx.save(command)
      result = { id: id(command), action, sequence, status: 'pending', idempotent: false }
    })
    return c.json(result.idempotent ? 200 : 201, result)
  } catch (error) {
    const known = ['party_not_found', 'party_expired', 'nothing_playing', 'invalid_idempotency_scope', 'controller_unavailable', 'controller_state_mismatch', 'playback_state_conflict', 'idempotency_conflict']
    const reason = known.includes(error.message) ? error.message : 'playback_command_failed'
    const status = reason === 'party_not_found' ? 404 : reason === 'party_expired' ? 410 : 409
    return json(c, status, reason, 'Playback command rejected')
  }
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
      set(queue, 'status', input.to)
      if (input.to === 'playing') set(queue, 'started_at', now())
      else {
        set(queue, 'completed_at', now())
        // PocketBase validates the composite unique index before SQLite can
        // apply NULL semantics. A distinct terminal sentinel releases the
        // video id for re-request without making every terminal row collide.
        set(queue, 'active_song_key', `terminal:${id(queue)}`)
      }
      if (input.to === 'failed') {
        let failureField = null
        try { failureField = tx.findCollectionByNameOrId('karaoke_queue').fields.getByName('failure_reason') } catch (_) {}
        let failureType = ''
        try { failureType = failureField && (typeof failureField.type === 'function' ? String(failureField.type()) : String(failureField.type || '')) } catch (_) {}
        if (failureType === 'text') {
          const configuredMax = Number(failureField.max || 160)
          const reasonMax = Math.min(160, configuredMax > 0 ? configuredMax : 160)
          set(queue, 'failure_reason', String(input.failureReason || 'playback_failed').slice(0, reasonMax))
        }
      }
      tx.save(queue)
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
    // Keep operational diagnosis non-secret: the client still receives only a
    // normalized code, while the retained server log has a bounded reason.
    try { console.error(`Queue transition failed (reason=${String(error?.message || 'unknown').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)})`) } catch (_) {}
    const known = ['queue_not_found', 'party_expired', 'stale_transition', 'controller_unavailable', 'party_already_playing', 'not_next']
    const reason = known.includes(error.message) ? error.message : 'transition_failed'
    const status = reason === 'queue_not_found' ? 404 : reason === 'party_expired' ? 410 : 409
    return json(c, status, reason, 'Queue transition rejected')
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
  const { auth, tablet, json, query, records, str, id, num, jsonValue } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const page = Math.max(1, Number(query(c, 'page') || 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query(c, 'perPage') || 25) || 25))
  const review = String(query(c, 'review') || '').trim(); const classification = String(query(c, 'classification') || '').trim()
  const clauses = []; const params = {}
  // The tablet's "Needs review" view is the actionable backlog: both records
  // awaiting their first decision and identity-corrected records returned to
  // review. Keep the legacy pending query alias for retained callers.
  if (review === 'pending' || review === 'needs_review') clauses.push('(review_status = "unreviewed" || review_status = "needs_review")')
  else if (review) { clauses.push('review_status = {:review}'); params.review = review }
  if (classification) { clauses.push('classification = {:classification}'); params.classification = classification }
  const filter = clauses.join(' && ') || ''
  let rows = []; let allRows = []
  try { rows = $app.findRecordsByFilter('karaoke_songs', filter, '+title,+youtube_id', perPage, (page - 1) * perPage, params); allRows = $app.findRecordsByFilter('karaoke_songs', filter, '+id', 100000, 0, params) } catch (_) { return json(c, 500, 'catalog_failed', 'Catalog could not be loaded') }
  const sliced = rows.slice(0, perPage)
  // Historical extra-row pagination used perPage + 1; exact totals now come
  // from a bounded count query over the same filter.
  const totalItems = allRows.length
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
  return c.json(200, { page, perPage, totalItems, totalPages, songs: sliced.map((song) => ({ id: id(song), youtubeId: str(song, 'youtube_id'), title: str(song, 'title'), artist: str(song, 'artist'), eligible: song.getBool ? song.getBool('eligible') : false, classification: str(song, 'classification') || 'unknown', classificationConfidence: num(song, 'classification_confidence'), alternativeCount: Array.isArray(jsonValue(song, 'alternatives_json', [])) ? jsonValue(song, 'alternatives_json', []).length : 0, classificationReason: str(song, 'eligibility_reason'), reviewState: str(song, 'review_status') || 'unreviewed', provenance: str(song, 'provenance'), source: str(song, 'source'), sourceId: str(song, 'source_id'), sourceList: str(song, 'source_list'), sourceRank: num(song, 'source_rank'), identityStatus: str(song, 'identity_status') || 'missing', identityReason: str(song, 'identity_reason'), videoTitle: str(song, 'video_title'), videoChannelTitle: str(song, 'video_channel_title'), videoChannelId: str(song, 'video_channel_id'), replacementYoutubeId: str(song, 'replacement_youtube_id'), importedAt: str(song, 'imported_at') })) })
})

routerAdd('POST', '/api/karaoke/tablet/catalog/import', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, future, find, set, setJson, jsonValue, requiredJsonValue, claimTransitionAllowed, validateClaimReplay, serializeJson, catalogBatchMismatch, num, hash, canonicalize, catalogFinalDigest, normalized, classifyCatalogItem, fetchYoutubeCandidates, dayKey, random, id, str, catalogImportFailureStage, logCatalogImportFailure } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const live = input.fetchFromYoutube === true; const canonical = input.canonical && typeof input.canonical === 'object' ? input.canonical : {}
  const batchKey = String(input.batchKey || '').trim(); let items = Array.isArray(input.items) ? input.items.slice(0, 100) : []; const offset = Number(input.offset)
  const manifestFingerprint = String(input.manifestFingerprint || ''); const finalDigest = String(input.finalDigest || ''); let total = Number(input.total); const source = input.source && typeof input.source === 'object' ? input.source : {}; const sourceUrl = String(source.url || (live ? 'https://www.youtube.com' : '')).slice(0, 500); const sourceTerms = String(source.terms || input.query || '').slice(0, 500); const sourceRetrievedAt = String(source.retrievedAt || '').slice(0, 80)
  const requestedMaxResults = Math.max(1, Math.min(50, Number(input.requestedMaxResults || total) || 10)); const requestFingerprint = hash(JSON.stringify(canonicalize(live ? { batchKey, manifestFingerprint, query: String(input.query || ''), canonical, requestedMaxResults, offset } : { offset, items })))
  if (!batchKey || (!live && !items.length) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || (live ? (offset !== 0 || total !== requestedMaxResults) : total < offset + items.length) || !/^[a-f0-9]{64}$/i.test(manifestFingerprint)) return json(c, 422, 'invalid_import', 'batchKey, manifestFingerprint, total, offset, and items are required')
  if (live) { let key = ''; try { key = String($os.getenv('YOUTUBE_API_KEY') || '') } catch (_) {} if (!key) return json(c, 503, 'youtube_key_unconfigured', 'Live YouTube import is temporarily unavailable'); if (!String(input.query || '').trim()) return json(c, 422, 'youtube_query_required', 'A search query is required'); if (!String(canonical.title || '').trim() || !String(canonical.artist || '').trim() || !String(canonical.source || '').trim()) return json(c, 422, 'canonical_identity_required', 'Live discovery requires canonical source, artist, and title') }
  let ownerToken = ''
  let attemptedCost = 0
  if (live) {
    try {
      ownerToken = hash(`${batchKey}:${requestFingerprint}:${random(24)}`)
      let durableChunkOutcome = ''
      $app.runInTransaction((tx) => {
        let batch = null; try { batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }) } catch (_) {}
        const mismatch = batch && catalogBatchMismatch(batch, { fingerprint: manifestFingerprint, url: sourceUrl, terms: sourceTerms, retrievedAt: sourceRetrievedAt, total }, !live)
        if (mismatch) throw new Error(`batch_source_mismatch_${mismatch}`)
        if (!batch) { batch = new Record(tx.findCollectionByNameOrId('karaoke_catalog_imports')); set(batch, 'batch_key', batchKey); set(batch, 'source_fingerprint', manifestFingerprint); set(batch, 'source_url', sourceUrl); set(batch, 'source_terms', sourceTerms); set(batch, 'source_retrieved_at', sourceRetrievedAt); set(batch, 'status', 'running'); set(batch, 'quota_limit', 10000); set(batch, 'quota_used', 0); set(batch, 'cursor', 0); set(batch, 'total', total); tx.save(batch) }
        const claimKey = `${batchKey}:${requestFingerprint}`
        let chunk = null; try { chunk = tx.findFirstRecordByFilter('karaoke_catalog_import_chunks', 'import = {:import} && offset = {:offset}', { import: id(batch), offset }) } catch (_) {}
        if (chunk) {
          if (str(chunk, 'chunk_fingerprint') !== requestFingerprint) throw new Error('chunk_source_mismatch')
          let replayClaim = null; try { replayClaim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: claimKey }) } catch (_) {}
          if (live && (!replayClaim || !['ready', 'complete'].includes(str(replayClaim, 'status')))) throw new Error('claim_state_conflict')
          if (replayClaim) {
            validateClaimReplay(replayClaim, requiredJsonValue(replayClaim, 'payload_json'), manifestFingerprint, requestFingerprint)
            const events = jsonValue(replayClaim, 'audit_json', []); const audit = Array.isArray(events) ? events : []
            if (str(replayClaim, 'status') === 'ready') {
              // Ready settlement atomically releases its reservation. A
              // nonzero value here is inconsistent retained state; clearing
              // only the claim would strand or double-release the quota row.
              if (num(replayClaim, 'reserved_units') !== 0) throw new Error('claim_reservation_conflict')
              audit.push({ action: 'resumed_commit', at: now() }); setJson(replayClaim, 'audit_json', audit.slice(-50))
              set(replayClaim, 'status', 'complete'); set(replayClaim, 'reserved_units', 0)
              if (!str(replayClaim, 'reservation_released_at')) set(replayClaim, 'reservation_released_at', now())
              set(replayClaim, 'lifecycle_reason', 'resumed_commit'); tx.save(replayClaim)
              durableChunkOutcome = 'resumed_commit'; return
            }
            audit.push({ action: 'exact_replay', at: now() }); setJson(replayClaim, 'audit_json', audit.slice(-50))
            set(replayClaim, 'replay_count', num(replayClaim, 'replay_count') + 1); set(replayClaim, 'lifecycle_reason', 'exact_replay'); tx.save(replayClaim)
            durableChunkOutcome = 'exact_replay'; return
          }
        }
        let claim = null; try { claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: claimKey }) } catch (_) {}
        if (claim && str(claim, 'status') === 'in_progress' && new Date(str(claim, 'lease_expires_at')).getTime() > Date.now()) throw new Error('youtube_request_in_progress')
        if (claim && str(claim, 'status') === 'in_progress') { const oldReserved = num(claim, 'reserved_units'); const oldDay = str(claim, 'quota_day_key'); if (oldReserved && oldDay) { const oldQuota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: oldDay }); set(oldQuota, 'reserved', Math.max(0, num(oldQuota, 'reserved') - oldReserved)); tx.save(oldQuota) } }
        if (claim && ['ready', 'complete'].includes(str(claim, 'status'))) {
          // A persisted payload is authoritative on replay. Reuse its owner so
          // the subsequent chunk commit can complete the claim without turning
          // an already-finished request into a stale-owner failure.
          ownerToken = str(claim, 'owner_token') || ownerToken
          const payload = validateClaimReplay(claim, requiredJsonValue(claim, 'payload_json'), manifestFingerprint, requestFingerprint)
          items = payload.items
          total = payload.total
          return
        }
        if (!claim) { claim = new Record(tx.findCollectionByNameOrId('karaoke_youtube_claims')); set(claim, 'claim_key', claimKey); set(claim, 'batch_key', batchKey) }
        set(claim, 'source_fingerprint', manifestFingerprint); set(claim, 'chunk_fingerprint', requestFingerprint)
        // Reclaimed/failed work starts a fresh quota reservation today. Only
        // ready/complete payload replays retain their persisted quota day.
        const quotaDay = dayKey(); set(claim, 'quota_day_key', quotaDay); set(claim, 'status', 'in_progress'); set(claim, 'reserved_units', 303); set(claim, 'owner_token', ownerToken); set(claim, 'lease_expires_at', future(120000)); set(claim, 'error_code', ''); tx.save(claim)
        let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }) } catch (_) {}
        if (!quota) { quota = new Record(tx.findCollectionByNameOrId('karaoke_youtube_quota')); set(quota, 'day_key', quotaDay); set(quota, 'quota_limit', 10000); set(quota, 'reserved', 0); set(quota, 'spent', 0) }
        if (num(quota, 'spent') + num(quota, 'reserved') + 303 > num(quota, 'quota_limit')) throw new Error('youtube_quota_exhausted'); set(quota, 'reserved', num(quota, 'reserved') + 303); tx.save(quota)
      })
      if (durableChunkOutcome === 'resumed_commit') return c.json(200, { batchKey, imported: 0, replay: false, resumed: true })
      if (durableChunkOutcome === 'exact_replay') return c.json(200, { batchKey, imported: 0, replay: true, resumed: false })
      let discovery = null; const existingClaim = find('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (existingClaim && ['ready', 'complete'].includes(str(existingClaim, 'status'))) { const payload = validateClaimReplay(existingClaim, requiredJsonValue(existingClaim, 'payload_json'), manifestFingerprint, requestFingerprint); items = payload.items; total = payload.total; discovery = { cost: 0 } } else { discovery = fetchYoutubeCandidates(String(input.query || ''), requestedMaxResults); items = discovery.items.map((item) => ({ ...item, canonicalTitle: String(canonical.title || ''), canonicalArtist: String(canonical.artist || ''), source: String(canonical.source || ''), sourceId: String(canonical.sourceId || ''), sourceList: String(canonical.sourceList || ''), sourceRank: Number(canonical.sourceRank || 0), sourcePopularity: Number(canonical.sourcePopularity || 0), genres: Array.isArray(canonical.genres) ? canonical.genres : [], releaseYear: Number(canonical.releaseYear || 0) })); total = items.length }
      const spent = discovery.cost; attemptedCost = spent
      if (!existingClaim || !['ready', 'complete'].includes(str(existingClaim, 'status'))) $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (!claim || str(claim, 'owner_token') !== ownerToken) throw new Error('youtube_claim_stale_owner'); if (!claimTransitionAllowed(str(claim, 'status'), 'ready')) throw new Error('youtube_claim_transition_invalid'); const batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }); const used = num(batch, 'quota_used'); if (used + spent > num(batch, 'quota_limit')) throw new Error('youtube_quota_exhausted'); const payloadDigest = hash(serializeJson({ items, total, spent })); set(batch, 'quota_used', used + spent); set(batch, 'total', total); set(batch, 'updated_at', now()); tx.save(batch); setJson(claim, 'payload_json', { items, total, spent, sourceFingerprint: manifestFingerprint, chunkFingerprint: requestFingerprint, payloadDigest, orderedIdentity: items.map((item) => String(item.youtubeId || '')) }); set(claim, 'source_fingerprint', manifestFingerprint); set(claim, 'chunk_fingerprint', requestFingerprint); set(claim, 'payload_digest', payloadDigest); setJson(claim, 'ordered_identity_json', items.map((item) => String(item.youtubeId || ''))); const reserved = num(claim, 'reserved_units'); set(claim, 'spent_units', num(claim, 'spent_units') + spent); set(claim, 'reserved_units', 0); set(claim, 'reservation_released_at', now()); set(claim, 'status', 'ready'); tx.save(claim); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + spent); tx.save(quota) })
    } catch (error) {
      try { console.error(`Catalog claim failed (reason=${String(error.message || 'unknown').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)})`) } catch (_) {}
      const batchMismatch = String(error.message || '').startsWith('batch_source_mismatch_')
      const claimConflict = String(error.message || '').startsWith('claim_')
      const permanent = batchMismatch || claimConflict || ['chunk_source_mismatch', 'youtube_quota_exhausted'].includes(error.message)
      try { $app.runInTransaction((tx) => { const batch = tx.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }); if (batch) { set(batch, 'status', permanent ? 'failed' : 'paused'); set(batch, 'last_error', String(error.message || 'youtube_import_failed').slice(0, 240)); set(batch, 'updated_at', now()); tx.save(batch) } const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (claim && str(claim, 'owner_token') === ownerToken) { const reserved = num(claim, 'reserved_units'); const consumed = Math.min(reserved, Number(error.quotaCost || attemptedCost || 0)); const qday = str(claim, 'quota_day_key'); if (reserved && qday) { const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: qday }); if (quota) { set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); if (consumed) set(quota, 'spent', num(quota, 'spent') + consumed); tx.save(quota) } } set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + consumed); set(claim, 'status', 'failed'); set(claim, 'error_code', String(error.message || 'youtube_import_failed')); tx.save(claim) } }) } catch (_) {}
      const code = batchMismatch ? 'batch_source_mismatch' : permanent ? error.message : 'youtube_import_failed'; const extra = batchMismatch ? { mismatchField: String(error.message).replace('batch_source_mismatch_', '') } : undefined; return json(c, code === 'batch_source_mismatch' || code === 'chunk_source_mismatch' || code === 'youtube_request_in_progress' || claimConflict ? 409 : 503, code, code === 'youtube_quota_exhausted' ? 'YouTube import quota is exhausted' : batchMismatch || claimConflict ? 'Import input does not match its original claim' : 'Live YouTube import failed', extra)
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
      const mismatch = catalogBatchMismatch(batch, { fingerprint: manifestFingerprint, url: sourceUrl, terms: sourceTerms, retrievedAt: sourceRetrievedAt, total }, true)
      if (mismatch) throw new Error(`batch_source_mismatch_${mismatch}`)
      let chunk = null; try { chunk = tx.findFirstRecordByFilter('karaoke_catalog_import_chunks', 'import = {:import} && offset = {:offset}', { import: id(batch), offset }) } catch (_) {}
      if (chunk && str(chunk, 'chunk_fingerprint') !== chunkFingerprint) throw new Error('chunk_source_mismatch')
      if (chunk) return
      if (offset !== num(batch, 'cursor')) throw new Error('chunk_out_of_order')
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const item = items[itemIndex]
        if (!/^[A-Za-z0-9_-]{11}$/.test(String(item.youtubeId || item.id || ''))) continue
        const youtubeId = String(item.youtubeId || item.id); let song = null
        try { song = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }) } catch (_) {}
        if (song) {
          const status = str(song, 'identity_status') || 'missing'
          if (['missing', 'uncertain'].includes(status)) {
            const history = jsonValue(song, 'review_history_json', []); const events = Array.isArray(history) ? history : []
            const proposal = { action: 'source_identity_proposal', title: String(item.canonicalTitle || item.title || '').trim().slice(0, 240), artist: String(item.canonicalArtist || item.artist || '').trim().slice(0, 160), sourceId: String(item.sourceId || '').slice(0, 160), sourceList: String(item.sourceList || '').slice(0, 120), at: now() }
            if (!events.some((event) => event?.action === proposal.action && event?.sourceId === proposal.sourceId && event?.title === proposal.title && event?.artist === proposal.artist)) events.push(proposal)
            setJson(song, 'review_history_json', events); set(song, 'eligible', false); set(song, 'review_status', 'needs_review'); set(song, 'identity_reason', 'canonical_source_identity_proposed'); tx.save(song)
          }
          continue // Never silently overwrite retained operator/source identity.
        }
        song = new Record(tx.findCollectionByNameOrId('karaoke_songs'))
        const title = String(item.canonicalTitle || item.title || '').trim().slice(0, 240); const artist = String(item.canonicalArtist || item.artist || '').trim().slice(0, 160); const identityComplete = Boolean(title && artist); const result = classifyCatalogItem(item); const normalizedTitle = normalized(title, 240); const normalizedArtist = normalized(artist, 160); const identityKey = identityComplete ? `${normalizedArtist}|${normalizedTitle}` : `missing|${youtubeId}`
        let identity = null; try { identity = tx.findFirstRecordByFilter('karaoke_songs', 'identity_key = {:identity}', { identity: identityKey }) } catch (_) {}
        if (identity) { const alternatives = jsonValue(identity, 'alternatives_json', []); const list = Array.isArray(alternatives) ? alternatives : []; if (!list.some((candidate) => String(candidate.youtubeId || '') === youtubeId)) { list.push({ youtubeId, videoTitle: String(item.videoTitle || ''), videoChannelTitle: String(item.channelTitle || ''), videoChannelId: String(item.channelId || ''), canonicalTitle: title, canonicalArtist: artist, classification: result.classification, classificationConfidence: result.confidence, classificationReason: result.reason, candidateRank: Number(item.candidateRank || 0), provenance: live ? 'youtube_api_import' : 'fixture_import', sourceId: String(item.sourceId || ''), sourceList: String(item.sourceList || ''), sourceRank: Number(item.sourceRank || 0), sourceUrl, sourceRetrievedAt: sourceRetrievedAt || now(), importedAt: now() }); setJson(identity, 'alternatives_json', list); tx.save(identity) } continue }
        set(song, 'youtube_id', youtubeId); set(song, 'title', title || youtubeId); set(song, 'artist', artist); set(song, 'provenance', live ? 'youtube_api_import' : 'fixture_import'); set(song, 'eligibility_reason', identityComplete ? result.reason : 'missing_canonical_identity'); set(song, 'source', String(item.source || (live ? 'listenbrainz' : 'fixture')).slice(0, 80)); set(song, 'source_query', String(input.query || source.terms || '').slice(0, 160)); set(song, 'source_url', sourceUrl); set(song, 'source_retrieved_at', sourceRetrievedAt || now()); set(song, 'source_rank', Number(item.sourceRank || offset + itemIndex + 1)); set(song, 'source_terms', sourceTerms); set(song, 'source_id', String(item.sourceId || '').slice(0, 160)); set(song, 'source_list', String(item.sourceList || '').slice(0, 120)); set(song, 'source_popularity', Number(item.sourcePopularity || 0)); setJson(song, 'genres_json', Array.isArray(item.genres) ? item.genres : []); set(song, 'release_year', Number(item.releaseYear || 0)); set(song, 'video_title', String(item.videoTitle || '').slice(0, 500)); set(song, 'video_channel_title', String(item.channelTitle || '').slice(0, 240)); set(song, 'video_channel_id', String(item.channelId || '').slice(0, 120)); set(song, 'identity_status', identityComplete ? 'verified_source' : 'missing'); set(song, 'identity_reason', identityComplete ? 'canonical_source_metadata' : 'missing_canonical_identity'); set(song, 'classification', result.classification); set(song, 'classification_confidence', result.confidence); set(song, 'review_status', identityComplete ? 'unreviewed' : 'needs_review'); set(song, 'eligible', false); set(song, 'normalized_title', normalizedTitle); set(song, 'normalized_artist', normalizedArtist); set(song, 'identity_key', identityKey); setJson(song, 'alternatives_json', []); setJson(song, 'review_history_json', []); setJson(song, 'metadata_json', { videoTitle: item.videoTitle || null, channelTitle: item.channelTitle || null, channelId: item.channelId || null, description: item.description || null, embeddable: item.embeddable === true, privacyStatus: item.privacyStatus || null, uploadStatus: item.uploadStatus || null, duration: item.duration || null, viewCount: item.viewCount || null }); set(song, 'import_batch', batchKey); set(song, 'imported_at', now()); diagnosticStage = 'song_save'; tx.save(song); imported++
      }
      if (!items.length) { if (live) { const emptyClaim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (emptyClaim && (!str(emptyClaim, 'owner_token') || str(emptyClaim, 'owner_token') === ownerToken)) { set(emptyClaim, 'status', 'complete'); set(emptyClaim, 'reserved_units', 0); tx.save(emptyClaim) } } const computed = catalogFinalDigest({ url: sourceUrl, terms: sourceTerms, retrievedAt: sourceRetrievedAt }, total, []); if (finalDigest && finalDigest !== computed) throw new Error('final_digest_mismatch'); set(batch, 'final_digest', computed); set(batch, 'cursor', total); set(batch, 'status', 'complete'); set(batch, 'updated_at', now()); diagnosticStage = 'batch_finalize'; tx.save(batch); return }
      chunk = new Record(tx.findCollectionByNameOrId('karaoke_catalog_import_chunks')); set(chunk, 'import', id(batch)); set(chunk, 'offset', offset); set(chunk, 'chunk_fingerprint', chunkFingerprint); set(chunk, 'item_count', items.length); setJson(chunk, 'payload_json', items); diagnosticStage = 'chunk_save'; tx.save(chunk)
      if (live) { const claim = tx.findFirstRecordByFilter('karaoke_youtube_claims', 'claim_key = {:claim}', { claim: `${batchKey}:${requestFingerprint}` }); if (claim && (!str(claim, 'owner_token') || str(claim, 'owner_token') === ownerToken)) { set(claim, 'status', 'complete'); set(claim, 'reserved_units', 0); tx.save(claim) } }
      const cursor = Math.max(num(batch, 'cursor'), offset + items.length); if (cursor >= total) { let all = []; try { const chunks = tx.findRecordsByFilter('karaoke_catalog_import_chunks', 'import = {:import}', '+offset', 1000, 0, { import: id(batch) }); chunks.forEach((part) => { const payload = jsonValue(part, 'payload_json', []); if (Array.isArray(payload)) all = all.concat(payload) }) } catch (_) {} const computed = catalogFinalDigest({ url: sourceUrl, terms: sourceTerms, retrievedAt: sourceRetrievedAt }, total, all); if (finalDigest && finalDigest !== computed) throw new Error('final_digest_mismatch'); set(batch, 'final_digest', computed) } set(batch, 'cursor', cursor); set(batch, 'status', cursor >= total ? 'complete' : 'paused'); set(batch, 'updated_at', now()); diagnosticStage = 'batch_finalize'; tx.save(batch)
    })
    return c.json(200, { batchKey, imported })
  } catch (error) { if (!live) logCatalogImportFailure(diagnosticStage, offset, items.length); const batchMismatch = String(error.message || '').startsWith('batch_source_mismatch_'); const mismatchField = batchMismatch ? String(error.message).replace('batch_source_mismatch_', '') : ''; const mismatch = batchMismatch || ['chunk_source_mismatch', 'chunk_out_of_order', 'final_digest_mismatch'].includes(error.message); let extra = !live ? { failureStage: catalogImportFailureStage(diagnosticStage) } : undefined; if (batchMismatch) { extra = { mismatchField }; if (mismatchField === 'total') { const failedBatch = find('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }); extra.actualTotal = failedBatch ? num(failedBatch, 'total') : null; extra.expectedTotal = total } } return json(c, mismatch ? 409 : 500, batchMismatch ? 'batch_source_mismatch' : mismatch ? error.message : 'import_failed', error.message === 'chunk_out_of_order' ? 'Import chunks must be submitted in order' : mismatch ? 'Import input does not match its original manifest' : 'Catalog import failed', extra) }
})

// Trusted public-playlist intake. The allowlist is server configuration, never
// request input: this makes arbitrary/guest playlist proxying impossible.
routerAdd('POST', '/api/karaoke/tablet/catalog/playlists/import', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, future, id, str, num, set, setJson, jsonValue, classifyCatalogItem, recordYoutubeOperation, dayKey, hash, serializeJson, random, youtubeRequest } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const PLAYLIST_OWNER_TTL = 6 * 60 * 60 * 1000
  const input = body(c)
  const sourceKey = String(input.sourceKey || '')
  if (!/^UC[A-Za-z0-9_-]{20,}:(?:PL|UU|LL|FL|RD)[A-Za-z0-9_-]{16,}$/.test(sourceKey)) return json(c, 422, 'playlist_source_key_invalid', 'Playlist source key must contain a valid channel and playlist identity')
  let allowlist = []
  try { allowlist = JSON.parse(String($os.getenv('KARAOKE_PLAYLIST_ALLOWLIST_JSON') || '[]')) } catch (_) { return json(c, 503, 'playlist_allowlist_invalid', 'Playlist allowlist is not configured') }
  if (!Array.isArray(allowlist) || !allowlist.length || allowlist.length > 12) return json(c, 503, 'playlist_allowlist_invalid', 'Playlist allowlist is not configured')
  const identities = new Set()
  for (const entry of allowlist) {
    const channelId = String(entry?.channelId || '')
    const playlistId = String(entry?.playlistId || '')
    const identity = `${channelId}:${playlistId}`
    if (!entry || typeof entry !== 'object' || !/^UC[A-Za-z0-9_-]{20,}$/.test(channelId) || !/^(?:PL|UU|LL|FL|RD)[A-Za-z0-9_-]{16,}$/.test(playlistId) || identities.has(identity)) return json(c, 503, 'playlist_allowlist_invalid', 'Playlist allowlist is not configured')
    identities.add(identity)
  }
  const source = allowlist.find((entry) => `${entry.channelId}:${entry.playlistId}` === sourceKey)
  if (!source || !/^UC[A-Za-z0-9_-]{20,}$/.test(String(source.channelId || '')) || !/^(?:PL|UU|LL|FL|RD)[A-Za-z0-9_-]{16,}$/.test(String(source.playlistId || ''))) return json(c, 422, 'playlist_source_not_allowed', 'Only configured trusted playlist sources may be imported')
  const maxItems = Math.max(1, Math.min(50, Number(input.maxItems || 25) || 25)); const pageToken = String(input.pageToken || '').slice(0, 240); const expectedSnapshot = String(input.snapshotFingerprint || ''); const dryRun = input.dryRun !== false; const revalidate = input.revalidate === true; const policyVersion = String(source.policyVersion || 'v1'); const claimKey = `playlist:${sourceKey}:${policyVersion}:${pageToken}:${maxItems}`
  if ((!dryRun || revalidate) && !/^[a-f0-9]{64}$/i.test(expectedSnapshot)) return json(c, 422, 'playlist_preview_required', 'Import requires an unchanged trusted-playlist preview')
  let priorSnapshot = null
  if (!dryRun || revalidate) { try { priorSnapshot = $app.findFirstRecordByFilter('karaoke_playlist_snapshots', 'source_key = {:source} && page_token = {:page} && snapshot_fingerprint = {:fingerprint}', { source: sourceKey, page: pageToken, fingerprint: expectedSnapshot }) } catch (_) {} if (!priorSnapshot && revalidate) return json(c, 409, 'playlist_snapshot_not_found', 'The retained playlist snapshot is unavailable'); if (priorSnapshot) { const validated = new Date(str(priorSnapshot, 'owner_validated_at') || str(priorSnapshot, 'retrieved_at')).getTime(); if (!revalidate && validated && Date.now() - validated <= PLAYLIST_OWNER_TTL) { let breakdown = {}; try { const replayClaim = $app.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }); breakdown = jsonValue(replayClaim, 'payload_json', {})?.unavailableReasons || {} } catch (_) {} return c.json(200, { sourceKey, imported: 0, unavailable: Number(breakdown.total || 0), unavailableReasons: breakdown, duplicates: 0, replay: true, nextPageToken: str(priorSnapshot, 'next_page_token') || '', snapshotFingerprint: expectedSnapshot }) } } }
  let key = ''; try { key = String($os.getenv('YOUTUBE_API_KEY') || '') } catch (_) {}
  if (!key) return json(c, 503, 'youtube_key_unconfigured', 'Live playlist import is temporarily unavailable')
  if (revalidate) {
    const revalidateKey = `playlist-revalidate:${sourceKey}:${pageToken}:${expectedSnapshot}`
    let prior = null; let cachedRevalidation = null; try { prior = $app.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: revalidateKey }) } catch (_) {}
    const priorPayload = jsonValue(prior, 'payload_json', {}) || {}
    const validReasons = (value) => value && typeof value === 'object' && Number.isInteger(Number(value.total)) && Number(value.total) >= 0 && Number.isInteger(Number(value.metadataMissing)) && Number.isInteger(Number(value.nonEmbeddable)) && value.privacy && value.uploadStatus
    if (prior && str(prior, 'status') === 'ready') { if (!validReasons(priorPayload.unavailableReasons)) return json(c, 503, 'playlist_revalidation_state_invalid', 'Stored playlist revalidation state is invalid'); return c.json(200, { sourceKey, snapshotFingerprint: expectedSnapshot, unavailable: Number(priorPayload.unavailableReasons.total || 0), unavailableReasons: priorPayload.unavailableReasons, revalidated: true, replay: true }) }
    const ids = jsonValue(priorSnapshot, 'ordered_video_ids_json', []); if (!Array.isArray(ids) || !ids.length) return json(c, 422, 'playlist_snapshot_invalid', 'The retained playlist snapshot has no video identities')
    const modeledVideos = Math.ceil(ids.length / 50); let revalidateOwner = ''; const attempts = { videosList: 0 }; const reserve = modeledVideos * 3
    try {
      $app.runInTransaction((tx) => {
        let claim = null; try { claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: revalidateKey }) } catch (_) {}
        if (claim && str(claim, 'status') === 'ready') { cachedRevalidation = jsonValue(claim, 'payload_json', {}); if (!validReasons(cachedRevalidation?.unavailableReasons)) throw new Error('playlist_revalidation_state_invalid'); return }
        if (claim && str(claim, 'status') === 'in_progress' && new Date(str(claim, 'lease_expires_at')).getTime() > Date.now()) throw new Error('playlist_revalidation_in_progress')
        if (claim && str(claim, 'status') === 'in_progress') { const oldReserved = num(claim, 'reserved_units'); let oldQuota = null; try { oldQuota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }) } catch (_) {} if (oldQuota) { set(oldQuota, 'reserved', Math.max(0, num(oldQuota, 'reserved') - oldReserved)); set(oldQuota, 'spent', num(oldQuota, 'spent') + oldReserved); tx.save(oldQuota) } set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + oldReserved); set(claim, 'status', 'failed'); tx.save(claim) }
        const quotaDay = dayKey(); let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }) } catch (_) {}
        if (!quota) { quota = new Record(tx.findCollectionByNameOrId('karaoke_youtube_quota')); set(quota, 'day_key', quotaDay); set(quota, 'quota_limit', 10000); set(quota, 'reserved', 0); set(quota, 'spent', 0) }
        if (num(quota, 'spent') + num(quota, 'reserved') + reserve > num(quota, 'quota_limit')) throw new Error('youtube_quota_exhausted')
        if (!claim) { claim = new Record(tx.findCollectionByNameOrId('karaoke_playlist_claims')); set(claim, 'claim_key', revalidateKey) }
        revalidateOwner = hash(`${revalidateKey}:${random(24)}`); set(quota, 'reserved', num(quota, 'reserved') + reserve); tx.save(quota); set(claim, 'status', 'in_progress'); set(claim, 'quota_day_key', quotaDay); set(claim, 'reserved_units', reserve); set(claim, 'owner_token', revalidateOwner); set(claim, 'lease_expires_at', future(120000)); tx.save(claim)
      })
      if (cachedRevalidation?.unavailableReasons) return c.json(200, { sourceKey, snapshotFingerprint: expectedSnapshot, unavailable: Number(cachedRevalidation.unavailableReasons.total || 0), unavailableReasons: cachedRevalidation.unavailableReasons, revalidated: true, replay: true })
      const meter = { cost: 0 }; let metadata; try { metadata = youtubeRequest(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(ids.join(','))}&key=${encodeURIComponent(key)}`, meter) } finally { attempts.videosList = meter.cost }
      const unavailableReasons = { total: 0, metadataMissing: 0, nonEmbeddable: 0, privacy: { public: 0, private: 0, unlisted: 0, missing: 0, other: 0 }, uploadStatus: { processed: 0, uploaded: 0, failed: 0, rejected: 0, missing: 0, other: 0 } }
      const videos = new Map((metadata.items || []).map((video) => [String(video.id || ''), video])); ids.forEach((videoId) => { const video = videos.get(videoId); if (!video) { unavailableReasons.total++; unavailableReasons.metadataMissing++; return } const status = video.status || {}; const unavailable = status.embeddable !== true || status.privacyStatus !== 'public' || status.uploadStatus !== 'processed'; if (unavailable) unavailableReasons.total++; if (status.embeddable !== true) unavailableReasons.nonEmbeddable++; const privacy = String(status.privacyStatus || 'missing'); if (privacy !== 'public') unavailableReasons.privacy[privacy in unavailableReasons.privacy ? privacy : 'other']++; const upload = String(status.uploadStatus || 'missing'); if (upload !== 'processed') unavailableReasons.uploadStatus[upload in unavailableReasons.uploadStatus ? upload : 'other']++ })
      $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: revalidateKey }); if (str(claim, 'owner_token') !== revalidateOwner) throw new Error('playlist_claim_stale'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); const reserved = num(claim, 'reserved_units'); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + attempts.videosList); tx.save(quota); set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + attempts.videosList); set(claim, 'status', 'ready'); setJson(claim, 'payload_json', { sourceKey, pageToken, snapshotFingerprint: expectedSnapshot, unavailableReasons }); tx.save(claim); recordYoutubeOperation(tx, 'videos.list', sourceKey, expectedSnapshot, modeledVideos, attempts.videosList) })
      return c.json(200, { sourceKey, snapshotFingerprint: expectedSnapshot, unavailable: unavailableReasons.total, unavailableReasons, revalidated: true, replay: false })
    } catch (error) { const code = error.message === 'youtube_quota_exhausted' ? 'youtube_quota_exhausted' : error.message === 'playlist_revalidation_in_progress' ? 'playlist_revalidation_in_progress' : 'playlist_revalidation_failed'; try { $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: revalidateKey }); if (!claim || !revalidateOwner || str(claim, 'owner_token') !== revalidateOwner) return; const reserved = num(claim, 'reserved_units'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); if (quota) { set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + attempts.videosList); tx.save(quota) } set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + attempts.videosList); set(claim, 'status', 'failed'); set(claim, 'error_code', code); tx.save(claim) }) } catch (_) {} return json(c, code === 'youtube_quota_exhausted' ? 429 : code === 'playlist_revalidation_in_progress' ? 409 : 503, code, code === 'youtube_quota_exhausted' ? 'Playlist revalidation quota is exhausted' : code === 'playlist_revalidation_in_progress' ? 'Playlist revalidation is already running' : 'Playlist revalidation failed') }
  }
  // Reserve the maximum first-page cost before any API call. A durable lease
  // coalesces identical previews; an expired unknown external state is charged
  // conservatively rather than risking an undercount.
  let ownerToken = ''; let cachedPreview = null
  try {
    $app.runInTransaction((tx) => {
      let claim = null; try { claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }) } catch (_) {}
      if (claim && str(claim, 'status') === 'ready') { const payload = jsonValue(claim, 'payload_json', null); const validated = new Date(String(payload?.ownerValidatedAt || '')).getTime(); if (dryRun && payload && validated && Date.now() - validated <= PLAYLIST_OWNER_TTL) { cachedPreview = payload; return } }
      if (claim && str(claim, 'status') === 'in_progress' && new Date(str(claim, 'lease_expires_at')).getTime() > Date.now()) throw new Error('playlist_import_in_progress')
      if (claim && str(claim, 'status') === 'in_progress') { const reserved = num(claim, 'reserved_units'); let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }) } catch (_) {} if (quota) { set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + reserved); tx.save(quota) } set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + reserved); set(claim, 'status', 'failed'); set(claim, 'error_code', 'stale_external_state'); tx.save(claim) }
      if (!claim) { claim = new Record(tx.findCollectionByNameOrId('karaoke_playlist_claims')); set(claim, 'claim_key', claimKey) }
      const quotaDay = dayKey(); let quota = null; try { quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: quotaDay }) } catch (_) {} if (!quota) { quota = new Record(tx.findCollectionByNameOrId('karaoke_youtube_quota')); set(quota, 'day_key', quotaDay); set(quota, 'quota_limit', 10000); set(quota, 'reserved', 0); set(quota, 'spent', 0) }
      const reserve = dryRun ? 6 : 9; if (num(quota, 'spent') + num(quota, 'reserved') + reserve > num(quota, 'quota_limit')) throw new Error('youtube_quota_exhausted'); ownerToken = hash(`${claimKey}:${random(24)}`); set(quota, 'reserved', num(quota, 'reserved') + reserve); tx.save(quota); set(claim, 'status', 'in_progress'); set(claim, 'quota_day_key', quotaDay); set(claim, 'reserved_units', reserve); set(claim, 'owner_token', ownerToken); set(claim, 'lease_expires_at', future(120000)); set(claim, 'error_code', ''); tx.save(claim)
    })
  } catch (error) { const code = String(error.message || '') === 'playlist_import_in_progress' ? 'playlist_import_in_progress' : String(error.message || '') === 'youtube_quota_exhausted' ? 'youtube_quota_exhausted' : 'playlist_claim_failed'; return json(c, code === 'playlist_import_in_progress' ? 409 : 503, code, code === 'playlist_import_in_progress' ? 'An identical playlist fetch is already running' : 'Playlist quota reservation failed') }
  if (cachedPreview) return c.json(200, { ...cachedPreview, replay: true })
  // Route callback workers do not reliably inherit direct $http bindings. Reuse
  // the established hook helper, which reloads safely and classifies retries.
  const attempts = { playlistsList: 0, playlistItemsList: 0, videosList: 0 }
  const call = (operation, path) => { const meter = { cost: 0 }; try { return youtubeRequest(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(key)}`, meter) } finally { attempts[operation] += meter.cost } }
  try {
    // playlists.list provides the authoritative owner. Do not trust the
    // playlist-items snippet uploader/channel as ownership evidence.
    const playlist = call('playlistsList', `playlists?part=snippet,status&id=${encodeURIComponent(source.playlistId)}`).items?.[0]
    if (!playlist || playlist.status?.privacyStatus !== 'public') throw new Error('playlist_unavailable')
    if (String(playlist.snippet?.channelId || '') !== String(source.channelId)) throw new Error('playlist_owner_mismatch')
    if (!dryRun && priorSnapshot) { $app.runInTransaction((tx) => { const snapshot = tx.findRecordById('karaoke_playlist_snapshots', id(priorSnapshot)); set(snapshot, 'owner_validated_at', now()); tx.save(snapshot); const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }); const reserved = num(claim, 'reserved_units'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + attempts.playlistsList); tx.save(quota); set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + attempts.playlistsList); set(claim, 'status', 'ready'); tx.save(claim); recordYoutubeOperation(tx, 'playlists.list', sourceKey, expectedSnapshot, 1, attempts.playlistsList) }); return c.json(200, { sourceKey, imported: 0, unavailable: 0, duplicates: 0, replay: true, ownerRevalidated: true, nextPageToken: str(priorSnapshot, 'next_page_token') || '', snapshotFingerprint: expectedSnapshot }) }
    const page = call('playlistItemsList', `playlistItems?part=snippet,contentDetails,status&playlistId=${encodeURIComponent(source.playlistId)}&maxResults=${maxItems}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    const rows = (page.items || []).map((item) => ({ playlistItemId: String(item.id || ''), position: Number(item.snippet?.position), youtubeId: String(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || ''), playlistTitle: String(item.snippet?.title || '') })).filter((item) => /^[A-Za-z0-9_-]{11}$/.test(item.youtubeId) && Number.isInteger(item.position))
    const snapshotFingerprint = hash(serializeJson({ sourceKey, policyVersion: String(source.policyVersion || 'v1'), pageToken, rows }))
    const modeled = { playlistsList: 1, playlistItemsList: 1, videosList: Math.ceil(rows.length / 50), total: 2 + Math.ceil(rows.length / 50) }
    if (!dryRun && expectedSnapshot !== snapshotFingerprint) throw new Error('playlist_preview_stale')
    if (dryRun) { const preview = { source: { sourceKey, channelId: source.channelId, playlistId: source.playlistId, channelName: source.channelName || '', playlistName: source.playlistName || playlist.snippet?.title || '', rationale: source.rationale || '', policyVersion }, expectedItems: rows.length, pageToken, nextPageToken: page.nextPageToken || '', snapshotFingerprint, modeledCost: modeled, ownerValidatedAt: now(), duplicates: 0 }; $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }); if (str(claim, 'owner_token') !== ownerToken) throw new Error('playlist_claim_stale'); const actual = attempts.playlistsList + attempts.playlistItemsList; const reserved = num(claim, 'reserved_units'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + actual); tx.save(quota); set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + actual); set(claim, 'status', 'ready'); setJson(claim, 'payload_json', preview); tx.save(claim); recordYoutubeOperation(tx, 'playlists.list', sourceKey, snapshotFingerprint, 1, attempts.playlistsList); recordYoutubeOperation(tx, 'playlistItems.list', sourceKey, snapshotFingerprint, 1, attempts.playlistItemsList) }); return c.json(200, preview) }
    const metadata = rows.length ? call('videosList', `videos?part=snippet,contentDetails,status&id=${encodeURIComponent(rows.map((row) => row.youtubeId).join(','))}`) : { items: [] }
    const videos = new Map((metadata.items || []).map((video) => [String(video.id || ''), video])); const metadataDigest = hash(serializeJson(rows.map((row) => ({ youtubeId: row.youtubeId, etag: String(videos.get(row.youtubeId)?.etag || ''), status: videos.get(row.youtubeId)?.status || null }))))
    let imported = 0; let unavailable = 0; let duplicates = 0; const unavailableReasons = { total: 0, metadataMissing: 0, nonEmbeddable: 0, privacy: { public: 0, private: 0, unlisted: 0, missing: 0, other: 0 }, uploadStatus: { processed: 0, uploaded: 0, failed: 0, rejected: 0, missing: 0, other: 0 } }
    $app.runInTransaction((tx) => {
      let snapshot = null; try { snapshot = tx.findFirstRecordByFilter('karaoke_playlist_snapshots', 'source_key = {:source} && page_token = {:page} && snapshot_fingerprint = {:fingerprint}', { source: sourceKey, page: pageToken, fingerprint: snapshotFingerprint }) } catch (_) {}
      if (snapshot) return
      snapshot = new Record(tx.findCollectionByNameOrId('karaoke_playlist_snapshots')); set(snapshot, 'source_key', sourceKey); set(snapshot, 'policy_version', String(source.policyVersion || 'v1')); set(snapshot, 'page_token', pageToken); set(snapshot, 'next_page_token', String(page.nextPageToken || '')); set(snapshot, 'snapshot_fingerprint', snapshotFingerprint); set(snapshot, 'metadata_digest', metadataDigest); setJson(snapshot, 'ordered_video_ids_json', rows.map((row) => row.youtubeId)); set(snapshot, 'retrieved_at', now()); set(snapshot, 'owner_validated_at', now()); tx.save(snapshot)
      for (const row of rows) {
        const video = videos.get(row.youtubeId); const status = video?.status || {}; const snippet = video?.snippet || {}; const embeddable = status.embeddable === true; const publicVideo = status.privacyStatus === 'public' && status.uploadStatus === 'processed'; if (!video || !embeddable || !publicVideo) { unavailable++; unavailableReasons.total++; if (!video) unavailableReasons.metadataMissing++; if (!embeddable) unavailableReasons.nonEmbeddable++; const privacy = String(status.privacyStatus || 'missing'); if (privacy !== 'public') unavailableReasons.privacy[privacy in unavailableReasons.privacy ? privacy : 'other']++; const upload = String(status.uploadStatus || 'missing'); if (upload !== 'processed') unavailableReasons.uploadStatus[upload in unavailableReasons.uploadStatus ? upload : 'other']++; continue }
        let existing = null; try { existing = tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId: row.youtubeId }) } catch (_) {}
        if (existing) { duplicates++; continue }
        const item = { videoTitle: String(snippet.title || row.playlistTitle), description: String(snippet.description || ''), channelTitle: String(snippet.channelTitle || ''), channelId: String(snippet.channelId || '') }; const quality = classifyCatalogItem(item)
        const song = new Record(tx.findCollectionByNameOrId('karaoke_songs')); set(song, 'youtube_id', row.youtubeId); set(song, 'title', row.youtubeId); set(song, 'artist', ''); set(song, 'provenance', 'trusted_playlist_import'); set(song, 'source', 'youtube_playlist'); set(song, 'source_id', sourceKey); set(song, 'source_list', String(source.playlistName || playlist.snippet?.title || '').slice(0, 120)); set(song, 'source_url', `https://www.youtube.com/playlist?list=${source.playlistId}`); set(song, 'source_retrieved_at', now()); set(song, 'source_rank', row.position + 1); set(song, 'playlist_source_id', source.playlistId); set(song, 'playlist_position', row.position); set(song, 'playlist_snapshot_fingerprint', snapshotFingerprint); set(song, 'metadata_digest', metadataDigest); set(song, 'video_title', item.videoTitle.slice(0, 500)); set(song, 'video_channel_title', item.channelTitle.slice(0, 240)); set(song, 'video_channel_id', item.channelId.slice(0, 120)); set(song, 'classification', quality.classification); set(song, 'classification_confidence', quality.confidence); set(song, 'eligibility_reason', 'missing_canonical_identity'); set(song, 'identity_status', 'missing'); set(song, 'identity_reason', 'playlist_metadata_not_canonical'); set(song, 'review_status', 'needs_review'); set(song, 'eligible', false); set(song, 'identity_key', `missing|${row.youtubeId}`); setJson(song, 'alternatives_json', []); setJson(song, 'review_history_json', [{ action: 'trusted_playlist_import', sourceKey, snapshotFingerprint, metadataDigest, at: now() }]); setJson(song, 'metadata_json', { duration: video.contentDetails?.duration || null, embeddable, privacyStatus: status.privacyStatus || null, uploadStatus: status.uploadStatus || null, videoTitle: item.videoTitle, channelTitle: item.channelTitle, channelId: item.channelId }); set(song, 'imported_at', now()); tx.save(song); imported++
      }
      recordYoutubeOperation(tx, 'playlists.list', sourceKey, snapshotFingerprint, 1, attempts.playlistsList); recordYoutubeOperation(tx, 'playlistItems.list', sourceKey, snapshotFingerprint, 1, attempts.playlistItemsList); if (modeled.videosList) recordYoutubeOperation(tx, 'videos.list', sourceKey, snapshotFingerprint, modeled.videosList, attempts.videosList)
      const actual = attempts.playlistsList + attempts.playlistItemsList + attempts.videosList; const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }); if (str(claim, 'owner_token') !== ownerToken) throw new Error('playlist_claim_stale'); const reserved = num(claim, 'reserved_units'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + actual); tx.save(quota); set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + actual); set(claim, 'status', 'ready'); setJson(claim, 'payload_json', { sourceKey, pageToken, nextPageToken: page.nextPageToken || '', snapshotFingerprint, metadataDigest, unavailableReasons }); tx.save(claim)
    })
    return c.json(200, { sourceKey, imported, unavailable, unavailableReasons, duplicates, replay: imported === 0 && duplicates === 0 && unavailable === 0, nextPageToken: page.nextPageToken || '', snapshotFingerprint, metadataDigest, modeledCost: modeled })
  } catch (error) { const message = String(error.message || ''); const upstream = /^(?:youtube_http_[1-5]\d\d|youtube_http_unavailable|youtube_network_error|youtube_request_failed)$/.test(message) ? message : ''; const auditCode = ['playlist_owner_mismatch', 'playlist_unavailable', 'playlist_preview_stale'].includes(message) ? message : upstream || 'external_result_ambiguous'; const observed = attempts.playlistsList + attempts.playlistItemsList + attempts.videosList; try { $app.runInTransaction((tx) => { const claim = tx.findFirstRecordByFilter('karaoke_playlist_claims', 'claim_key = {:key}', { key: claimKey }); if (claim && str(claim, 'owner_token') === ownerToken) { const reserved = num(claim, 'reserved_units'); const quota = tx.findFirstRecordByFilter('karaoke_youtube_quota', 'day_key = {:day}', { day: str(claim, 'quota_day_key') }); set(quota, 'reserved', Math.max(0, num(quota, 'reserved') - reserved)); set(quota, 'spent', num(quota, 'spent') + observed); tx.save(quota); set(claim, 'reserved_units', 0); set(claim, 'spent_units', num(claim, 'spent_units') + observed); set(claim, 'status', 'failed'); set(claim, 'error_code', auditCode); tx.save(claim) } }) } catch (_) {} const code = ['playlist_owner_mismatch', 'playlist_unavailable', 'playlist_preview_stale'].includes(message) ? message : upstream || 'playlist_import_failed'; return json(c, code === 'playlist_owner_mismatch' || code === 'playlist_unavailable' || code === 'playlist_preview_stale' ? (code === 'playlist_unavailable' ? 404 : 409) : upstream ? 502 : 503, code, code === 'playlist_owner_mismatch' ? 'Playlist ownership does not match the trusted source allowlist' : code === 'playlist_unavailable' ? 'The trusted playlist is unavailable or no longer public' : code === 'playlist_preview_stale' ? 'Playlist changed since preview; review it again before importing' : upstream ? 'Trusted playlist source is temporarily unavailable' : 'Trusted playlist import failed') }
})

// Explicitly selected, bounded batch approval. This is deliberately not a
// filter-based or blanket action: every requested id must independently meet
// the same identity and karaoke gates as a single approval.
routerAdd('POST', '/api/karaoke/tablet/catalog/review/batch', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, id, str, num, set, setJson, jsonValue, random } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const ids = [...new Set(Array.isArray(body(c).ids) ? body(c).ids.map((value) => String(value || '')).filter(Boolean) : [])]
  if (!ids.length || ids.length > 20) return json(c, 422, 'invalid_batch_selection', 'Select between 1 and 20 songs')
  try {
    const batchId = random(20); let approved = 0
    $app.runInTransaction((tx) => {
      const songs = ids.map((songId) => tx.findRecordById('karaoke_songs', songId))
      for (const song of songs) { const identityReady = ['verified_source', 'operator_corrected'].includes(str(song, 'identity_status')) && Boolean(str(song, 'artist')) && Boolean(str(song, 'title')); const collision = tx.findRecordsByFilter('karaoke_songs', 'identity_key = {:identity} && id != {:id}', '', 1, 0, { identity: str(song, 'identity_key'), id: id(song) }); const alternatives = jsonValue(song, 'alternatives_json', []); if (str(song, 'review_status') === 'approved' || str(song, 'classification') !== 'karaoke' || num(song, 'classification_confidence') < 0.8 || !identityReady || collision.length || (Array.isArray(alternatives) && alternatives.length)) throw new Error('batch_song_ineligible') }
      for (let index = 0; index < songs.length; index++) { const song = songs[index]; const history = jsonValue(song, 'review_history_json', []); const events = Array.isArray(history) ? history : []; if (index === 0) events.push({ action: 'batch_review_summary', state: 'approved', batchId, ids, approved: songs.length, by: id(auth(c)), at: now() }); events.push({ action: 'batch_review', state: 'approved', batchId, by: id(auth(c)), at: now() }); setJson(song, 'review_history_json', events); set(song, 'review_status', 'approved'); set(song, 'eligible', true); set(song, 'reviewed_at', now()); set(song, 'reviewed_by', id(auth(c))); tx.save(song); approved++ }
    })
    return c.json(200, { approved, ids, batchId })
  } catch (error) { const code = error.message === 'batch_song_ineligible' ? 'batch_song_ineligible' : 'batch_review_failed'; return json(c, code === 'batch_song_ineligible' ? 409 : 500, code, code === 'batch_song_ineligible' ? 'Every selected song must be identity-verified, unapproved karaoke' : 'Selected approval failed') }
})

routerAdd('POST', '/api/karaoke/tablet/catalog/{id}/review', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, id, str, set, setJson, jsonValue } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const requestedReviewState = String(input.reviewState || ''); const reviewState = requestedReviewState === 'pending' ? 'unreviewed' : requestedReviewState
  if (!['unreviewed', 'approved', 'rejected', 'needs_review'].includes(reviewState)) return json(c, 422, 'invalid_review', 'Review state is invalid')
  try {
    let result = null
    $app.runInTransaction((tx) => { const song = tx.findRecordById('karaoke_songs', c.request.pathValue('id')); if (!song) throw new Error('song_not_found'); const history = jsonValue(song, 'review_history_json', []); const events = Array.isArray(history) ? history : []; events.push({ action: 'review', state: reviewState, note: input.note === undefined ? '' : String(input.note).slice(0, 240), by: id(auth(c)), at: now() }); setJson(song, 'review_history_json', events); set(song, 'review_status', reviewState); set(song, 'reviewed_at', now()); set(song, 'reviewed_by', id(auth(c))); if (input.note !== undefined) set(song, 'eligibility_reason', String(input.note).slice(0, 240)); const classification = str(song, 'classification') || 'unknown'; const identityReady = ['verified_source', 'operator_corrected'].includes(str(song, 'identity_status')) && Boolean(str(song, 'artist')) && Boolean(str(song, 'title')); set(song, 'eligible', reviewState === 'approved' && classification === 'karaoke' && identityReady); tx.save(song); result = { id: id(song), reviewState, eligible: song.getBool ? song.getBool('eligible') : false } })
    return c.json(200, result)
  } catch (error) { return json(c, error.message === 'song_not_found' ? 404 : 500, error.message === 'song_not_found' ? 'song_not_found' : 'review_failed', error.message === 'song_not_found' ? 'Song was not found' : 'Catalog review failed') }
})

routerAdd('POST', '/api/karaoke/tablet/catalog/{id}/identity', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, id, str, set, setJson, jsonValue, normalized } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const title = String(input.title || '').trim().slice(0, 240); const artist = String(input.artist || '').trim().slice(0, 160); const reason = String(input.reason || '').trim().slice(0, 240)
  if (!title || !artist || !reason) return json(c, 422, 'canonical_identity_required', 'Canonical artist, title, and correction reason are required')
  try {
    let result = null
    $app.runInTransaction((tx) => {
      const song = tx.findRecordById('karaoke_songs', c.request.pathValue('id')); if (!song) throw new Error('song_not_found')
      const normalizedTitle = normalized(title, 240); const normalizedArtist = normalized(artist, 160); const identityKey = `${normalizedArtist}|${normalizedTitle}`
      let collision = null; try { collision = tx.findFirstRecordByFilter('karaoke_songs', 'identity_key = {:identity} && id != {:id}', { identity: identityKey, id: id(song) }) } catch (_) {}
      if (collision) throw new Error('identity_conflict')
      const history = jsonValue(song, 'review_history_json', []); const events = Array.isArray(history) ? history : []
      events.push({ action: 'identity_correction', from: { title: str(song, 'title'), artist: str(song, 'artist'), status: str(song, 'identity_status') }, to: { title, artist, status: 'operator_corrected' }, reason, by: id(auth(c)), at: now() })
      setJson(song, 'review_history_json', events); set(song, 'title', title); set(song, 'artist', artist); set(song, 'normalized_title', normalizedTitle); set(song, 'normalized_artist', normalizedArtist); set(song, 'identity_key', identityKey); set(song, 'identity_status', 'operator_corrected'); set(song, 'identity_reason', reason); set(song, 'review_status', 'needs_review'); set(song, 'eligible', false); set(song, 'reviewed_at', now()); set(song, 'reviewed_by', id(auth(c))); tx.save(song)
      result = { id: id(song), title, artist, identityStatus: 'operator_corrected', reviewState: 'needs_review', eligible: false }
    })
    return c.json(200, result)
  } catch (error) { const code = ['song_not_found', 'identity_conflict'].includes(error.message) ? error.message : 'identity_correction_failed'; return json(c, code === 'song_not_found' ? 404 : code === 'identity_conflict' ? 409 : 500, code, code === 'song_not_found' ? 'Song was not found' : code === 'identity_conflict' ? 'Canonical identity already belongs to another catalog song' : 'Canonical identity correction failed') }
})

routerAdd('GET', '/api/karaoke/tablet/catalog/report', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, str, num, jsonValue } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  let songs = []
  try { songs = $app.findRecordsByFilter('karaoke_songs', '', '+id', 100000, 0) } catch (_) { return json(c, 500, 'catalog_report_failed', 'Catalog report could not be generated') }
  const countBy = (key) => songs.reduce((out, song) => { const value = String(key(song) || 'unknown'); out[value] = (out[value] || 0) + 1; return out }, {})
  const alternatives = songs.reduce((sum, song) => { const value = jsonValue(song, 'alternatives_json', []); return sum + (Array.isArray(value) ? value.length : 0) }, 0)
  return c.json(200, {
    total: songs.length,
    bySource: countBy((song) => str(song, 'source')),
    byClassification: countBy((song) => str(song, 'classification')),
    byReviewState: countBy((song) => str(song, 'review_status')),
    byIdentityStatus: countBy((song) => str(song, 'identity_status')),
    byDecade: countBy((song) => { const year = num(song, 'release_year'); return year ? `${Math.floor(year / 10) * 10}s` : 'unknown' }),
    byConfidenceBand: countBy((song) => { const confidence = num(song, 'classification_confidence'); return confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low' }),
    missingIdentity: songs.filter((song) => !str(song, 'artist') || !str(song, 'title') || ['missing', 'uncertain'].includes(str(song, 'identity_status'))).length,
    unavailable: songs.filter((song) => ['unavailable', 'private', 'deleted'].includes(str(song, 'eligibility_reason'))).length,
    alternatives,
    unresolvedReviewBacklog: songs.filter((song) => ['unreviewed', 'needs_review'].includes(str(song, 'review_status'))).length,
  })
})

routerAdd('POST', '/api/karaoke/tablet/catalog/{id}/replace', (c) => {
  try { require(__hooks + '/party_queue.pb.js') } catch (_) {}
  const { auth, tablet, json, body, now, id, str, set, setJson, jsonValue, YOUTUBE_ID } = globalThis.__partyQueue
  if (!tablet(auth(c))) return json(c, 403, 'forbidden', 'tablet_admin authentication required')
  const input = body(c); const candidateId = String(input.candidateId || ''); const youtubeId = String(input.youtubeId || '')
  if (!candidateId && !YOUTUBE_ID.test(youtubeId)) return json(c, 422, 'invalid_replacement', 'A replacement candidate is required')
  try {
    let result = null; $app.runInTransaction((tx) => { const song = tx.findRecordById('karaoke_songs', c.request.pathValue('id')); if (!song) throw new Error('song_not_found'); const candidate = candidateId ? tx.findRecordById('karaoke_songs', candidateId) : tx.findFirstRecordByFilter('karaoke_songs', 'youtube_id = {:youtubeId}', { youtubeId }); if (!candidate || id(candidate) === id(song)) throw new Error('invalid_replacement'); if (str(candidate, 'classification') !== 'karaoke' || str(candidate, 'review_status') !== 'approved' || !(candidate.getBool ? candidate.getBool('eligible') : false)) throw new Error('replacement_unavailable'); const history = jsonValue(song, 'review_history_json', []); const events = Array.isArray(history) ? history : []; events.push({ action: 'replacement', replacementYoutubeId: str(candidate, 'youtube_id'), reason: String(input.reason || 'operator_replacement').slice(0, 240), by: id(auth(c)), at: now() }); setJson(song, 'review_history_json', events); set(song, 'replacement_youtube_id', str(candidate, 'youtube_id')); set(song, 'replacement_reason', String(input.reason || 'operator_replacement').slice(0, 240)); set(song, 'eligible', false); tx.save(song); result = { id: id(song), replacementYoutubeId: str(candidate, 'youtube_id'), eligible: false } }); return c.json(200, result)
  } catch (error) { const code = ['song_not_found', 'invalid_replacement', 'replacement_unavailable'].includes(error.message) ? error.message : 'replace_failed'; return json(c, code === 'song_not_found' ? 404 : code === 'replace_failed' ? 500 : 409, code, code === 'song_not_found' ? 'Song was not found' : code === 'invalid_replacement' ? 'Replacement candidate was not found' : code === 'replacement_unavailable' ? 'Replacement candidate must be approved eligible karaoke' : 'Catalog replacement failed') }
})
