// Forward-only repair for retained deployments where the initial trusted-playlist
// migration was recorded without all of its private collections. This is
// intentionally additive: no existing catalog, quota, claim, or audit record is
// removed or rewritten.
migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const makePrivate = (collection) => {
    let changed = false
    for (const key of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) {
      if (collection[key] !== null) { collection[key] = null; changed = true }
    }
    return changed
  }
  const ensureField = (collection, name, type, options = {}) => {
    try { collection.fields.getByName(name); return false } catch (_) {}
    collection.fields.add(new Field({ name, type, ...options }))
    return true
  }
  const ensure = (name, fields, indexes = []) => {
    let collection = find(name)
    if (!collection) {
      collection = new Collection({ name, type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: fields.map(([field, type, options]) => ({ name: field, type, ...options })), indexes })
      app.save(collection)
      return
    }
    let changed = makePrivate(collection)
    for (const [field, type, options] of fields) changed = ensureField(collection, field, type, options) || changed
    if (changed) app.save(collection)
    for (const index of indexes) {
      if (collection.indexes.includes(index)) continue
      collection.indexes.push(index)
      try { app.save(collection) } catch (_) { collection.indexes = collection.indexes.filter((item) => item !== index) }
    }
  }

  const songs = find('karaoke_songs')
  if (songs) {
    let changed = false
    for (const [field, type, options] of [
      ['playlist_source_id', 'text', { max: 120 }],
      ['playlist_position', 'number', { min: 0, noDecimal: true }],
      ['playlist_snapshot_fingerprint', 'text', { max: 64 }],
      ['metadata_digest', 'text', { max: 64 }],
    ]) changed = ensureField(songs, field, type, options) || changed
    if (changed) app.save(songs)
  }

  ensure('karaoke_youtube_operations', [
    ['day_key', 'text', { required: true, max: 16 }],
    ['operation_class', 'text', { required: true, max: 80 }],
    ['modeled_units', 'number', { min: 0, noDecimal: true }],
    ['observed_calls', 'number', { min: 0, noDecimal: true }],
    ['source_key', 'text', { max: 240 }],
    ['snapshot_fingerprint', 'text', { max: 64 }],
  ], ['CREATE UNIQUE INDEX idx_karaoke_youtube_operation_class ON karaoke_youtube_operations (day_key, operation_class, source_key, snapshot_fingerprint)'])
  ensure('karaoke_playlist_snapshots', [
    ['source_key', 'text', { required: true, max: 240 }],
    ['policy_version', 'text', { required: true, max: 40 }],
    ['page_token', 'text', { max: 240 }],
    ['next_page_token', 'text', { max: 240 }],
    ['snapshot_fingerprint', 'text', { required: true, max: 64 }],
    ['metadata_digest', 'text', { max: 64 }],
    ['ordered_video_ids_json', 'json'],
    ['retrieved_at', 'date'],
    ['owner_validated_at', 'date'],
  ], ['CREATE UNIQUE INDEX idx_karaoke_playlist_snapshot ON karaoke_playlist_snapshots (source_key, page_token, snapshot_fingerprint)'])
  ensure('karaoke_playlist_claims', [
    ['claim_key', 'text', { required: true, max: 320 }],
    ['status', 'select', { required: true, maxSelect: 1, values: ['in_progress', 'ready', 'failed'] }],
    ['quota_day_key', 'text', { required: true, max: 16 }],
    ['reserved_units', 'number', { min: 0, noDecimal: true }],
    ['spent_units', 'number', { min: 0, noDecimal: true }],
    ['owner_token', 'text', { max: 120 }],
    ['lease_expires_at', 'date'],
    ['payload_json', 'json'],
    ['error_code', 'text', { max: 120 }],
  ], ['CREATE UNIQUE INDEX idx_karaoke_playlist_claim_key ON karaoke_playlist_claims (claim_key)'])
}, () => {})
