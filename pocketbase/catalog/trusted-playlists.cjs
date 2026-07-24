'use strict'

// PocketBase 0.39.7 evaluates hooks in a Goja worker VM.  Node built-ins are
// unavailable there, so keep the module load side-effect free and use the
// runtime-provided $security helpers when present.  The lazy Node fallback is
// retained for the repository's ordinary Node contract tests.
let nodeCrypto = null
try { if (typeof require === 'function') nodeCrypto = require('node:crypto') } catch (_) {}

function runtimeSha256(value) {
  if (typeof $security !== 'undefined' && $security?.sha256) return String($security.sha256(String(value)))
  if (nodeCrypto) return nodeCrypto.createHash('sha256').update(String(value)).digest('hex')
  throw new Error('confirmation_crypto_unavailable')
}

function runtimeRandom(length) {
  if (typeof $security !== 'undefined' && $security?.randomString) return String($security.randomString(length))
  if (nodeCrypto) return nodeCrypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
  throw new Error('confirmation_crypto_unavailable')
}

function base64urlEncode(value) {
  if (typeof Buffer !== 'undefined') return Buffer.from(String(value)).toString('base64url')
  const bytes = unescape(encodeURIComponent(String(value))); const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) { const a = bytes.charCodeAt(i); const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0; const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0; const n = (a << 16) | (b << 8) | c; out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=') }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(value) {
  if (typeof Buffer !== 'undefined') return Buffer.from(String(value), 'base64url').toString('utf8')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const encoded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '='); let bytes = ''
  for (let i = 0; i < encoded.length; i += 4) { const a = alphabet.indexOf(encoded[i]); const b = alphabet.indexOf(encoded[i + 1]); const c = alphabet.indexOf(encoded[i + 2]); const d = alphabet.indexOf(encoded[i + 3]); const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d); bytes += String.fromCharCode((n >>> 16) & 255); if (encoded[i + 2] !== '=') bytes += String.fromCharCode((n >>> 8) & 255); if (encoded[i + 3] !== '=') bytes += String.fromCharCode(n & 255) }
  return decodeURIComponent(escape(bytes))
}

function workerRuntime() { return !nodeCrypto && typeof $security !== 'undefined' && Boolean($security?.randomString && $security?.sha256) }
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^(?:PL|UU|LL|FL|RD)[A-Za-z0-9_-]{16,}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/
const MAX_PLAYLIST_INPUT = 512

/** Parse only YouTube playlist identities; never treat arbitrary URLs as fetch targets. */
function parsePlaylistInput(raw) {
  const value = String(raw || '').trim()
  if (!value || value.length > MAX_PLAYLIST_INPUT) throw new Error('playlist_input_invalid')
  if (PLAYLIST_ID.test(value)) return { playlistId: value, sourceKey: value, input: value }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^https?:\/\//i.test(value)) throw new Error('playlist_scheme_invalid')
  let url
  try { url = new URL(value) } catch (_) { throw new Error('playlist_url_invalid') }
  if (url.protocol !== 'https:') throw new Error('playlist_scheme_invalid')
  const host = url.hostname.toLowerCase()
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) throw new Error('playlist_host_invalid')
  const playlistId = url.searchParams.get('list') || ''
  if (!PLAYLIST_ID.test(playlistId)) throw new Error('playlist_id_invalid')
  for (const key of url.searchParams.keys()) if (!['list', 'index'].includes(key)) throw new Error('playlist_parameter_invalid')
  return { playlistId, sourceKey: playlistId, input: value }
}

function issueConfirmation(payload, secret, ttlMs = 10 * 60 * 1000) {
  if (!secret) throw new Error('confirmation_secret_missing')
  // Goja has no HMAC primitive. Worker-issued confirmations are opaque,
  // high-entropy bearer values; the persisted confirmation row (digest,
  // admin, snapshot, bindings, and expiry) is the sole authority.
  if (workerRuntime()) return `pb1.${runtimeRandom(64)}`
  const body = { ...payload, exp: Date.now() + Math.max(1000, Math.min(ttlMs, 60 * 60 * 1000)), nonce: runtimeRandom(24) }
  const encoded = base64urlEncode(JSON.stringify(body))
  const sig = nodeCrypto.createHmac('sha256', String(secret)).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

function verifyConfirmation(token, secret, expected = {}) {
  if (!secret || typeof token !== 'string' || token.length > 4096) throw new Error('confirmation_invalid')
  if (workerRuntime()) {
    if (!/^pb1\.[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('confirmation_invalid')
    // Opaque worker tokens carry no caller-verifiable claims.  The persisted
    // confirmation row is authoritative; never echo caller-supplied
    // expectations as if they were token claims.
    return { opaque: true }
  }
  const [encoded, supplied] = token.split('.')
  if (!encoded || !supplied) throw new Error('confirmation_invalid')
  const actual = nodeCrypto.createHmac('sha256', String(secret)).update(encoded).digest('base64url')
  if (supplied.length !== actual.length) throw new Error('confirmation_invalid')
  let different = 0; for (let i = 0; i < actual.length; i++) different |= supplied.charCodeAt(i) ^ actual.charCodeAt(i)
  if (different !== 0) throw new Error('confirmation_invalid')
  let body; try { body = JSON.parse(base64urlDecode(encoded)) } catch (_) { throw new Error('confirmation_invalid') }
  if (!Number.isFinite(body.exp) || body.exp < Date.now()) throw new Error('confirmation_expired')
  for (const [key, value] of Object.entries(expected)) if (JSON.stringify(body[key]) !== JSON.stringify(value)) throw new Error('confirmation_binding_mismatch')
  return body
}

function isApprovable(song, scope = {}) {
  if (!song || (scope.source && String(song.source || '') !== String(scope.source))) return false
  if (scope.filter && typeof scope.filter === 'object') for (const [k, v] of Object.entries(scope.filter)) if (v !== undefined && String(song[k] ?? '') !== String(v)) return false
  if (String(song.review_status) !== 'needs_review') return false
  if (!['verified_source', 'operator_corrected'].includes(String(song.identity_status))) return false
  // Approval is the gate that makes a candidate guest-eligible. Pending
  // candidates are therefore expected to have eligible=false; do not require
  // the derived guest flag to already be true here.
  if (!String(song.artist || '').trim() || !String(song.title || '').trim() || String(song.classification) !== 'karaoke') return false
  if (song.embeddable === false || song.available === false || ['live', 'fallback', 'cover', 'tutorial', 'medley', 'mix', 'fallback_lyric', 'fallback_audio', 'policy_rejected', 'unavailable', 'region_blocked', 'non_embeddable'].includes(String(song.eligibility_reason))) return false
  if (song.conflict || song.canonical_conflict || (Array.isArray(song.alternatives_json) && song.alternatives_json.length)) return false
  return true
}

function confirmationBinding(payload) {
  return {
    adminId: String(payload.adminId || ''), playlistId: String(payload.playlistId || ''),
    ownerChannelId: String(payload.ownerChannelId || ''), visibility: String(payload.visibility || ''),
    orderedVideoIds: Array.isArray(payload.orderedVideoIds) ? payload.orderedVideoIds.map(String) : [],
    etag: String(payload.etag || ''), snapshotFingerprint: String(payload.snapshotFingerprint || payload.snapshot || ''),
    expectedCounts: payload.expectedCounts || {}, importCap: Number(payload.importCap || 0),
    pageToken: String(payload.pageToken || ''), policyVersion: String(payload.policyVersion || '')
  }
}

function parseSourceKey(sourceKey) {
  const value = String(sourceKey || '')
  const parts = value.split(':')
  if (parts.length !== 2 || !CHANNEL_ID.test(parts[0]) || !PLAYLIST_ID.test(parts[1])) {
    throw new Error('playlist_source_key_invalid')
  }
  return { channelId: parts[0], playlistId: parts[1], sourceKey: value }
}

function resolveAllowlistedSource(raw, sourceKey) {
  const parsed = parseSourceKey(sourceKey)
  const rows = parseAllowlist(raw)
  return rows.find((row) => row.channelId === parsed.channelId && row.playlistId === parsed.playlistId) || null
}


function digest(value) {
  return runtimeSha256(JSON.stringify(value))
}

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:karaoke version|karaoke|instrumental|backing track|official)\b/g, ' ')
    .replace(/\b(?:originally performed by|in the style of)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ')
}

function parseAllowlist(raw) {
  let rows
  try { rows = JSON.parse(String(raw || '[]')) } catch (_) { throw new Error('playlist_allowlist_invalid_json') }
  if (!Array.isArray(rows) || !rows.length || rows.length > 12) throw new Error('playlist_allowlist_invalid')
  const seen = new Set()
  return rows.map((row) => {
    const channelId = String(row?.channelId || '')
    const playlistId = String(row?.playlistId || '')
    const key = `${channelId}:${playlistId}`
    if (!CHANNEL_ID.test(channelId) || !PLAYLIST_ID.test(playlistId) || seen.has(key)) throw new Error('playlist_allowlist_identity_invalid')
    seen.add(key)
    return { channelId, playlistId, channelName: String(row.channelName || '').slice(0, 160), playlistName: String(row.playlistName || '').slice(0, 240), rationale: String(row.rationale || '').slice(0, 500), policyVersion: String(row.policyVersion || 'v1').slice(0, 40) }
  })
}

function playlistSnapshot(source, page) {
  const items = Array.isArray(page?.items) ? page.items : []
  const ordered = items.map((item) => ({
    playlistItemId: String(item?.id || ''), position: Number(item?.snippet?.position), videoId: String(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || ''),
  }))
  if (!ordered.length || ordered.some((item) => !YOUTUBE_ID.test(item.videoId) || !Number.isInteger(item.position))) throw new Error('playlist_snapshot_invalid')
  return { source, pageToken: String(page?.pageToken || ''), nextPageToken: String(page?.nextPageToken || ''), etag: String(page?.etag || ''), ordered, fingerprint: digest({ source, pageToken: String(page?.pageToken || ''), ordered }) }
}

function metadataDigest(snapshot, videos) {
  const byId = new Map((Array.isArray(videos) ? videos : []).map((video) => [String(video?.id || ''), video]))
  return digest(snapshot.ordered.map((row) => ({ id: row.videoId, etag: String(byId.get(row.videoId)?.etag || ''), status: byId.get(row.videoId)?.status || null })))
}

function parseTitle(raw, profile = 'artist-title') {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text || /\b(live|concert|tutorial|lesson|medley|mix|compilation)\b/i.test(text)) return { confidence: 0, reason: 'unsafe_title' }
  const cleaned = text.replace(/\[[^\]]*\]|\([^)]*(?:karaoke|key|female|male|instrumental|version)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim()
  if (profile !== 'artist-title' && profile !== 'title-artist') return { confidence: 0, reason: 'profile_unsupported' }
  const match = cleaned.match(/^(.+?)\s+[-–—|]\s+(.+)$/)
  if (!match) return { confidence: 0, reason: 'title_unparsed' }
  const [left, right] = match.slice(1).map((v) => v.trim())
  const artist = profile === 'title-artist' ? right : left
  const title = profile === 'title-artist' ? left : right
  if (!artist || !title || /\bkaraoke\b/i.test(artist)) return { confidence: 0, reason: 'artist_unsafe' }
  return { artist, title, normalizedArtist: normalized(artist), normalizedTitle: normalized(title), confidence: 0.55, reason: 'unverified_title_parse' }
}

function modeledCost(itemCount) { return { playlistItemsList: 1, videosList: Math.ceil(Math.max(0, itemCount) / 50), total: 1 + Math.ceil(Math.max(0, itemCount) / 50) } }

module.exports = { YOUTUBE_ID, parseAllowlist, parseSourceKey, parsePlaylistInput, issueConfirmation, verifyConfirmation, confirmationBinding, isApprovable, resolveAllowlistedSource, playlistSnapshot, metadataDigest, parseTitle, modeledCost, digest, normalized }
