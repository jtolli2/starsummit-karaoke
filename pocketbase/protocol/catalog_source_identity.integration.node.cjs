'use strict'

// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/catalog_source_identity.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

test('PocketBase 0.39.7 adds source identity fields without rewriting retained songs', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-source-identity-pb-'))
  const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  fs.writeFileSync(path.join(migrations, '1784512890_seed_song.js'), `migrate((app) => {
    const collection = new Collection({ name: 'karaoke_songs', type: 'base', fields: [
      { name: 'youtube_id', type: 'text', required: true }, { name: 'title', type: 'text' },
      { name: 'artist', type: 'text' }, { name: 'marker', type: 'text' },
      { name: 'eligible', type: 'bool' }, { name: 'review_status', type: 'text' },
      { name: 'review_history_json', type: 'json' },
    ] })
    app.save(collection)
    const record = new Record(collection); record.set('youtube_id', 'nMDXPAM8RwE')
    record.set('title', 'retained title'); record.set('artist', 'retained uploader')
    record.set('marker', 'preserve-me'); record.set('eligible', true)
    record.set('review_status', 'approved'); record.set('review_history_json', [{ action: 'review', state: 'approved' }]); app.save(record)
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512900_catalog_source_identity.js'), path.join(migrations, '1784512900_catalog_source_identity.js'))
  fs.writeFileSync(path.join(migrations, '1784512910_assert_source_identity.js'), `migrate((app) => {
    const collection = app.findCollectionByNameOrId('karaoke_songs')
    for (const name of ['source_id', 'source_list', 'video_title', 'video_channel_title', 'video_channel_id', 'identity_status']) {
      if (!collection.fields.getByName(name)) throw new Error('missing field ' + name)
    }
    const record = app.findRecordsByFilter('karaoke_songs', 'marker = "preserve-me"', '', 1, 0)[0]
    if (!record || record.get('youtube_id') !== 'nMDXPAM8RwE' || record.get('artist') !== 'retained uploader') throw new Error('retained song changed')
    if (record.get('identity_status') !== 'missing') throw new Error('retained identity not safely missing')
    if (record.get('eligible') !== false || record.get('review_status') !== 'needs_review') throw new Error('retained song not quarantined')
    const history = record.get('review_history_json')
    if (!Array.isArray(history) || history.length !== 2 || history[1].action !== 'identity_quarantine') throw new Error('quarantine audit missing')
  }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  assert.ok(true)
})
