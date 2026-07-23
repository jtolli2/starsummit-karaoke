'use strict'

const crypto = require('node:crypto')
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^(?:PL|UU|LL|FL|RD)[A-Za-z0-9_-]{16,}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
  const match = profile === 'title-artist' ? cleaned.match(/^(.+?)\s+[-–—|]\s+(.+)$/) : cleaned.match(/^(.+?)\s+[-–—|]\s+(.+)$/)
  if (!match) return { confidence: 0, reason: 'title_unparsed' }
  const [left, right] = match.slice(1).map((v) => v.trim())
  const artist = profile === 'title-artist' ? right : left
  const title = profile === 'title-artist' ? left : right
  if (!artist || !title || /\bkaraoke\b/i.test(artist)) return { confidence: 0, reason: 'artist_unsafe' }
  return { artist, title, normalizedArtist: normalized(artist), normalizedTitle: normalized(title), confidence: 0.55, reason: 'unverified_title_parse' }
}

function modeledCost(itemCount) { return { playlistItemsList: 1, videosList: Math.ceil(Math.max(0, itemCount) / 50), total: 1 + Math.ceil(Math.max(0, itemCount) / 50) } }

module.exports = { YOUTUBE_ID, parseAllowlist, playlistSnapshot, metadataDigest, parseTitle, modeledCost, digest, normalized }
