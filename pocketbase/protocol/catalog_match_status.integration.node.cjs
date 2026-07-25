'use strict'

// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/catalog_match_status.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

test('PocketBase retained matcher status repair preserves shape and is idempotent', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-mb-status-pb-'))
  const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  fs.writeFileSync(path.join(migrations, '1784989990_seed_song.js'), `migrate((app) => {
    const collection = new Collection({ name: 'karaoke_songs', type: 'base', fields: [
      { name: 'youtube_id', type: 'text', required: true }, { name: 'title', type: 'text' },
      { name: 'artist', type: 'text' }, { name: 'mb_match_status', type: 'select', maxSelect: 1, values: ['not_attempted', 'matched', 'deferred', 'garbage'], required: false },
      { name: 'marker', type: 'text' }, { name: 'zero_value', type: 'number' },
      { name: 'json_value', type: 'json' }, { name: 'nullable_value', type: 'text' },
    ] }); app.save(collection)
    const rows = [ ['', 'blank'], ['matched', 'matched'], ['deferred', 'deferred'], ['garbage', 'invalid'] ]
    for (const [status, marker] of rows) { const row = new Record(collection); row.set('youtube_id', marker.padEnd(11, 'x').slice(0, 11)); row.set('title', 'title-' + marker); row.set('artist', 'artist-' + marker); row.set('mb_match_status', status); row.set('marker', marker); row.set('zero_value', 0); row.set('json_value', { keep: marker }); row.set('nullable_value', null); app.save(row) }
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784991000_repair_musicbrainz_match_status.js'), path.join(migrations, '1784991000_repair_musicbrainz_match_status.js'))
  // A second forward filename deliberately replays the identical repair body;
  // this proves idempotency rather than merely proving PocketBase's migration
  // ledger skips an already-applied filename.
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784991000_repair_musicbrainz_match_status.js'), path.join(migrations, '1784991005_repair_musicbrainz_match_status_replay.js'))
  fs.writeFileSync(path.join(migrations, '1784991010_assert_song.js'), `migrate((app) => {
    const rows = app.findRecordsByFilter('karaoke_songs', '', '+id', 20, 0)
    const expected = { blank: 'not_attempted', matched: 'matched', deferred: 'deferred', invalid: 'not_attempted' }
    for (const row of rows) { const marker = row.get('marker'); if (row.get('mb_match_status') !== expected[marker]) throw new Error('status mismatch ' + marker); if (row.get('title') !== 'title-' + marker || row.get('artist') !== 'artist-' + marker || row.get('zero_value') !== 0 || row.get('json_value').keep !== marker || row.get('nullable_value') !== null) throw new Error('retained shape changed ' + marker) }
  }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  assert.ok(true)
})
