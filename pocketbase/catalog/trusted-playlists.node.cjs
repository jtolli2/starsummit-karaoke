'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseAllowlist, playlistSnapshot, metadataDigest, parseTitle, modeledCost } = require('./trusted-playlists.cjs')

const source = { channelId: 'UC12345678901234567890', playlistId: 'PL123456789012345678901234', policyVersion: 'v1' }
test('allowlist is bounded and rejects arbitrary playlist identities', () => {
  assert.deepEqual(parseAllowlist(JSON.stringify([source]))[0].playlistId, source.playlistId)
  assert.throws(() => parseAllowlist('[]'), /playlist_allowlist_invalid/)
  assert.throws(() => parseAllowlist(JSON.stringify([{ ...source, playlistId: 'bad' }])), /identity_invalid/)
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
})
