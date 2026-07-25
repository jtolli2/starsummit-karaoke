'use strict'
const crypto = require('node:crypto')
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function bindJob({ sourceId, snapshotFingerprint, songs, policyVersion = 'mb-v1', parserVersion = 'yt-title-v1' }) {
  if (!sourceId || !/^[a-f0-9]{64}$/i.test(snapshotFingerprint)) throw new Error('snapshot_binding_invalid')
  const inputs = songs.map((song) => ({ id: String(song.id), youtubeId: String(song.youtube_id), title: String(song.video_title || ''), snapshot: String(song.playlist_snapshot_fingerprint || '') }))
  return { jobKey: digest({ sourceId, snapshotFingerprint, policyVersion, parserVersion, inputs }), sourceId, snapshotFingerprint, policyVersion, parserVersion, inputDigest: digest(inputs), inputs }
}
function acquireLease(store, now = Date.now(), interval = 1000) {
  return store.transaction((state) => { const next = Number(state.nextAllowedAt || 0); if (next > now) return false; state.nextAllowedAt = now + interval; return true })
}
function checkpoint(report, item, outcome) { const next = { ...report, outcomes: Array.isArray(report.outcomes) ? report.outcomes.slice() : [] }; if (!next.outcomes.some((entry) => entry.id === item.id)) next.outcomes.push({ id: item.id, inputDigest: digest(item), ...outcome }); next.outcomes.sort((a, b) => a.id.localeCompare(b.id)); return next }
module.exports = { digest, bindJob, acquireLease, checkpoint }
