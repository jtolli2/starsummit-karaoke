'use strict'

// Focused real-runtime proof. Run with:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/catalog_chunk_offset.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

test('PocketBase 0.39.7 repairs required zero offset without rewriting records', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-offset-pb-'))
  const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  fs.writeFileSync(path.join(migrations, '1784512590_seed_required_offset.js'), `migrate((app) => {
    const collection = new Collection({ name: 'karaoke_catalog_import_chunks', type: 'base', fields: [
      { name: 'offset', type: 'number', required: true, min: 0, noDecimal: true },
      { name: 'marker', type: 'text' },
    ] })
    app.save(collection)
    const record = new Record(collection)
    record.set('offset', 0); record.set('marker', 'preserve-me'); app.save(record)
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512600_repair_catalog_chunk_offset_required.js'), path.join(migrations, '1784512600_repair_catalog_chunk_offset_required.js'))
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512700_repair_catalog_checkpoint_field_api.js'), path.join(migrations, '1784512700_repair_catalog_checkpoint_field_api.js'))
  fs.writeFileSync(path.join(migrations, '1784512710_assert_offset_repair.js'), `migrate((app) => {
    const collection = app.findCollectionByNameOrId('karaoke_catalog_import_chunks')
    const field = collection.fields.getByName('offset')
    const type = typeof field.type === 'function' ? field.type() : field.type
    if (type !== 'number') throw new Error('offset type changed')
    if (field.required) throw new Error('offset remained required')
    const record = app.findRecordsByFilter('karaoke_catalog_import_chunks', 'marker = "preserve-me"', '', 1, 0)[0]
    if (!record || record.get('offset') !== 0 || record.get('marker') !== 'preserve-me') throw new Error('checkpoint record changed')
  }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  // A second migration pass must remain clean and idempotent.
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  assert.ok(true)
})

test('forward final digest repair preserves retained imports and is idempotent', { skip: !process.env.POCKETBASE_BIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-digest-pb-'))
  const migrations = path.join(root, 'pb_migrations'); fs.mkdirSync(migrations)
  fs.writeFileSync(path.join(migrations, '1784512790_seed_import.js'), `migrate((app) => {
    const collection = new Collection({ name: 'karaoke_catalog_imports', type: 'base', fields: [
      { name: 'batch_key', type: 'text' }, { name: 'marker', type: 'text' },
    ] })
    app.save(collection)
    const record = new Record(collection); record.set('batch_key', 'retain-me'); record.set('marker', 'preserve-me'); app.save(record)
  }, () => {})`)
  fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', '1784512800_repair_catalog_final_digest.js'), path.join(migrations, '1784512800_repair_catalog_final_digest.js'))
  fs.writeFileSync(path.join(migrations, '1784512810_assert_digest_repair.js'), `migrate((app) => {
    const collection = app.findCollectionByNameOrId('karaoke_catalog_imports')
    const field = collection.fields.getByName('final_digest')
    const type = typeof field.type === 'function' ? field.type() : field.type
    if (type !== 'text') throw new Error('digest type changed')
    const record = app.findRecordsByFilter('karaoke_catalog_imports', 'marker = "preserve-me"', '', 1, 0)[0]
    if (!record || record.get('batch_key') !== 'retain-me' || record.get('marker') !== 'preserve-me') throw new Error('import record changed')
  }, () => {})`)
  const dataDir = path.join(root, 'pb_data'); const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  assert.ok(true)
})
