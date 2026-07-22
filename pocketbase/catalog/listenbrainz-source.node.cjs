'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { canonicalRecording, normalized, selectCorpus } = require('./listenbrainz-source.cjs')

test('collaboration aliases normalize deterministically without changing display metadata', () => {
  const row = canonicalRecording({ artist_name: 'Artist & Guest feat. Singer', track_name: 'Song!', recording_mbid: 'mbid', listen_count: 10 }, 'all_time', 1)
  assert.equal(row.canonicalArtist, 'Artist & Guest feat. Singer')
  assert.equal(row.normalizedArtist, 'artist guest feat singer')
  assert.equal(normalized('Artist ft. Singer'), 'artist feat singer')
})

test('ambiguous source identity stays uncertain and cannot enter the selected corpus', () => {
  const ambiguous = canonicalRecording({ artist_name: 'Various Artists', track_name: 'Song', recording_mbid: 'mbid' }, 'year', 1)
  assert.equal(ambiguous.identityStatus, 'uncertain')
  assert.deepEqual(selectCorpus({ year: [{ artist_name: 'Various Artists', track_name: 'Song', recording_mbid: 'mbid' }] }), [])
})

test('corpus selection interleaves lists, deduplicates identity, and caps artist concentration', () => {
  const row = (artist, title, id) => ({ artist_name: artist, track_name: title, recording_mbid: id, listen_count: 1 })
  const selected = selectCorpus({ all_time: [row('A', 'One', '1'), row('A', 'Two', '2')], year: [row('A', 'One', '1'), row('B', 'Three', '3')] }, { perArtist: 1 })
  assert.deepEqual(selected.map((item) => `${item.canonicalArtist}:${item.canonicalTitle}`), ['A:One', 'B:Three'])
})
