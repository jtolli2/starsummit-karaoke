'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { recordingFromSeries, selectCorpus } = require('./musicbrainz-series-source.cjs')

const relation = (id, title, rank) => ({ recording: { id, title }, 'ordering-key': rank })
const recording = (id, title, artist) => ({ id, title, 'artist-credit': [{ name: artist }] })

test('ordered series preserves canonical collaboration display and stable rank identity', () => {
  const item = recordingFromSeries(relation('mbid-1', 'Song!', 7), recording('mbid-1', 'Song!', 'Artist feat. Guest'), { id: 'series-1', name: 'Party list' })
  assert.equal(item.canonicalArtist, 'Artist feat. Guest')
  assert.equal(item.normalizedArtist, 'artist feat guest')
  assert.equal(item.sourceRank, 7)
  assert.equal(item.sourceId, 'mbid-1')
  assert.equal(item.identityStatus, 'verified_source')
})

test('MusicBrainz join phrases and earliest official release year remain canonical display data', () => {
  const detailed = {
    id: 'mbid-1', title: 'Song',
    'artist-credit': [
      { name: 'Artist', joinphrase: ' feat. ' }, { name: 'Guest', joinphrase: ' & ' },
      { name: 'Singer', joinphrase: ', ' }, { name: 'Friend' },
    ],
    releases: [
      { status: 'Bootleg', date: '1960-01-01' }, { status: 'Official', date: '1972-04-03' },
      { status: 'Official', date: '1970' }, { status: 'Official', date: 'unknown' },
    ],
  }
  const item = recordingFromSeries(relation('mbid-1', 'Song', 1), detailed, { id: 'series-1', name: 'List' })
  assert.equal(item.canonicalArtist, 'Artist feat. Guest & Singer, Friend')
  assert.equal(item.releaseYear, 1970)
})

test('missing artist or series rank remains uncertain', () => {
  const item = recordingFromSeries(relation('mbid-1', 'Song', 0), recording('mbid-1', 'Song', ''), { id: 'series-1', name: 'List' })
  assert.equal(item.identityStatus, 'uncertain')
  assert.deepEqual(selectCorpus([item]), [])
})

test('series corpus deduplicates canonical identity and caps artist concentration', () => {
  const make = (id, title, artist, rank) => recordingFromSeries(relation(id, title, rank), recording(id, title, artist), { id: 'series', name: 'List' })
  const selected = selectCorpus([make('1', 'One', 'A', 1), make('2', 'One', 'A', 2), make('3', 'Two', 'A', 3), make('4', 'Three', 'B', 4)], { perArtist: 1 })
  assert.deepEqual(selected.map((item) => `${item.canonicalArtist}:${item.canonicalTitle}`), ['A:One', 'B:Three'])
})
