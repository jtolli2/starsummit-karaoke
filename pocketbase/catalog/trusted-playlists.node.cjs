'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { parseAllowlist, parseSourceKey, resolveAllowlistedSource, playlistSnapshot, metadataDigest, parseTitle, modeledCost } = require('./trusted-playlists.cjs')

const source = { channelId: 'UC12345678901234567890', playlistId: 'PL123456789012345678901234', policyVersion: 'v1' }
const singKing = { channelId: 'UCwTRjvjVge51X-ILJ4i22ew', playlistId: 'PL8D4Iby0Bmm-uQIcbRfHeUMd_YDSZDA39', policyVersion: 'v1' }
test('allowlist is bounded and rejects arbitrary playlist identities', () => {
  assert.deepEqual(parseAllowlist(JSON.stringify([source]))[0].playlistId, source.playlistId)
  assert.throws(() => parseAllowlist('[]'), /playlist_allowlist_invalid/)
  assert.throws(() => parseAllowlist(JSON.stringify([{ ...source, playlistId: 'bad' }])), /identity_invalid/)
})
test('source keys distinguish malformed syntax from an unconfigured but valid identity', () => {
  assert.deepEqual(parseSourceKey(`${singKing.channelId}:${singKing.playlistId}`), {
    channelId: singKing.channelId,
    playlistId: singKing.playlistId,
    sourceKey: `${singKing.channelId}:${singKing.playlistId}`,
  })
  assert.throws(() => parseSourceKey('not-a-source-key'), /playlist_source_key_invalid/)
  const configured = JSON.stringify([singKing])
  assert.equal(resolveAllowlistedSource(configured, `${singKing.channelId}:${singKing.playlistId}`).playlistId, singKing.playlistId)
  assert.equal(resolveAllowlistedSource(configured, `${source.channelId}:${source.playlistId}`), null)
})
test('playlist snapshot binds ordered video ids and metadata digest', () => {
  const snapshot = playlistSnapshot(source, { etag: 'page', items: [{ id: 'pi1', snippet: { position: 0, resourceId: { videoId: 'dQw4w9WgXcQ' } } }] })
  assert.equal(snapshot.ordered[0].videoId, 'dQw4w9WgXcQ')
  assert.equal(metadataDigest(snapshot, [{ id: 'dQw4w9WgXcQ', etag: 'video', status: { embeddable: true } }]).length, 64)
  assert.throws(() => playlistSnapshot(source, { items: [{ snippet: { position: 0 } }] }), /snapshot_invalid/)
})
test('title parser keeps uploader separate and rejects unsafe formats', () => {
  assert.deepEqual(parseTitle('Rick Astley - Never Gonna Give You Up (Karaoke Version)').artist, 'Rick Astley')
  assert.equal(parseTitle('Karaoke Brand - A Song').reason, 'artist_unsafe')
  assert.equal(parseTitle('Singer - Song Live at Wembley').reason, 'unsafe_title')
  assert.deepEqual(modeledCost(51), { playlistItemsList: 1, videosList: 2, total: 3 })
  assert.equal(parseTitle('Artist - Song', 'channel-name').reason, 'profile_unsupported')
})

test('PocketBase route validates bounded allowlist and separates unavailable from ownership mismatch', () => {
  const hook = fs.readFileSync(require('node:path').join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')
  assert.match(hook, /playlist_allowlist_invalid/)
  assert.match(hook, /allowlist\.length > 12/)
  assert.match(hook, /identities\.has\(identity\)/)
  assert.match(hook, /throw new Error\('playlist_unavailable'\)/)
  assert.match(hook, /throw new Error\('playlist_owner_mismatch'\)/)
  assert.match(hook, /unavailableReasons/)
  assert.match(hook, /revalidate === true/)
  assert.match(hook, /revalidateKey = `playlist-revalidate:/)
  assert.match(hook, /playlist_revalidation_in_progress/)
  assert.match(hook, /metadataMissing/)
  assert.match(hook, /const reserve = modeledVideos \* 3/)
  assert.match(hook, /playlist_revalidation_state_invalid/)
  assert.match(hook, /if \(!priorSnapshot && revalidate\)/)
  assert.match(hook, /importPhase = 'owner_fetch'/)
  assert.match(hook, /importPhase = 'snapshot_verify'; const snapshotFingerprint/)
  assert.match(hook, /importPhase = 'settle_success'; recordYoutubeOperation/)
  assert.match(hook, /playlist_import_settle_success_failed/)
  assert.match(hook, /playlist_import_persist_results_failed/)
  assert.match(hook, /const phaseCodes = \['owner_fetch'/)
  assert.match(hook, /importPhase = 'snapshot_save'/)
  assert.match(hook, /importPhase = 'song_save'/)
})
