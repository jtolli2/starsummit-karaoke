// Repair retained databases where the catalog migration history exists but the
// karaoke_songs collection itself is missing (for example after a partial
// restore). This migration is additive and never removes records or fields.
migrate((app) => {
  const find = (name) => {
    try { return app.findCollectionByNameOrId(name) } catch (_) { return null }
  }

  const addField = (collection, name, type, options = {}) => {
    let existing = null
    try { existing = collection.fields.getByName(name) } catch (_) {}
    if (existing) return false
    collection.fields.add(new Field({ name, type, ...options }))
    return true
  }

  // Restore field metadata without rewriting any records.  A type mismatch is
  // intentionally left untouched: changing a field's type can be destructive
  // for retained data and requires an operator-led migration.
  const ensureField = (collection, name, type, options = {}) => {
    let field
    try { field = collection.fields.getByName(name) } catch (_) {}
    if (!field) {
      collection.fields.add(new Field({ name, type, ...options }))
      return true
    }
    if (field.type !== type) return false
    let changed = false
    for (const [key, value] of Object.entries(options)) {
      if (JSON.stringify(field[key]) !== JSON.stringify(value)) {
        field[key] = value
        changed = true
      }
    }
    return changed
  }

  const makePrivate = (collection) => {
    let changed = false
    for (const key of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) {
      if (collection[key] !== null) {
        collection[key] = null
        changed = true
      }
    }
    return changed
  }

  const ensureIndex = (collection, sql) => {
    if (!collection.indexes.includes(sql)) {
      collection.indexes.push(sql)
      return true
    }
    return false
  }

  let songs = find('karaoke_songs')
  if (!songs) {
    songs = new Collection({
      name: 'karaoke_songs', type: 'base',
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'youtube_id', type: 'text', required: true, min: 11, max: 11 },
        { name: 'title', type: 'text', required: true, max: 240 },
        { name: 'artist', type: 'text', max: 160 },
        { name: 'eligible', type: 'bool', default: false },
        { name: 'provenance', type: 'text', max: 120 },
        { name: 'eligibility_reason', type: 'text', max: 240 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_karaoke_songs_youtube ON karaoke_songs (youtube_id)'],
    })
    app.save(songs)
  }

  let changed = makePrivate(songs)

  // Keep the original queue/catalog contract intact if a partially-created
  // collection is present, while adding every field introduced by the catalog
  // migration.
  const baseFields = [
    ['youtube_id', 'text', { required: true, min: 11, max: 11 }],
    ['title', 'text', { required: true, max: 240 }],
    ['artist', 'text', { required: false, max: 160 }],
    ['eligible', 'bool', { required: false, default: false }],
    ['provenance', 'text', { required: false, max: 120 }],
    ['eligibility_reason', 'text', { required: false, max: 240 }],
  ]
  for (const [name, type, options] of baseFields) changed = ensureField(songs, name, type, options) || changed
  const catalogFields = [
    ['source', 'text', { max: 80 }],
    ['source_query', 'text', { max: 160 }],
    ['source_url', 'text', { max: 500 }],
    ['source_retrieved_at', 'date', {}],
    ['source_rank', 'number', { min: 0, noDecimal: true }],
    ['source_terms', 'text', { max: 500 }],
    ['classification', 'select', { maxSelect: 1, values: ['karaoke', 'original', 'lyric', 'live', 'cover', 'fallback_lyric', 'fallback_audio', 'other', 'unknown'], required: true, default: 'unknown' }],
    ['classification_confidence', 'number', { min: 0, max: 1 }],
    ['review_status', 'select', { maxSelect: 1, values: ['unreviewed', 'approved', 'rejected', 'needs_review'], required: true, default: 'unreviewed' }],
    ['reviewed_at', 'date', {}],
    ['reviewed_by', 'text', { max: 120 }],
    ['replacement_youtube_id', 'text', { min: 11, max: 11 }],
    ['replacement_reason', 'text', { max: 240 }],
    ['metadata_json', 'json', {}],
    ['normalized_title', 'text', { max: 240 }],
    ['normalized_artist', 'text', { max: 160 }],
    ['identity_key', 'text', { max: 420 }],
    ['alternatives_json', 'json', {}],
    ['review_history_json', 'json', {}],
    ['import_batch', 'text', { max: 80 }],
    ['imported_at', 'date', {}],
  ]
  for (const [name, type, options] of catalogFields) changed = addField(songs, name, type, options) || changed
  changed = ensureIndex(songs, 'CREATE UNIQUE INDEX idx_karaoke_songs_youtube ON karaoke_songs (youtube_id)') || changed
  if (changed) app.save(songs)

  // A partial restore can leave karaoke_queue.song pointing at an obsolete
  // collection id. Rebind only the relation metadata; queue records remain
  // untouched and retain their existing song ids.
  const queue = find('karaoke_queue')
  if (queue) {
    try {
      const songRelation = queue.fields.getByName('song')
      if (songRelation.type === 'relation' && songRelation.collectionId !== songs.id) {
        songRelation.collectionId = songs.id
        app.save(queue)
      }
    } catch (_) {}
  }

  let imports = find('karaoke_catalog_imports')
  if (!imports) {
    imports = new Collection({
      name: 'karaoke_catalog_imports', type: 'base', listRule: null, viewRule: null,
      createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'batch_key', type: 'text', required: true, min: 1, max: 80 },
        { name: 'source_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'source_url', type: 'text', max: 500 }, { name: 'source_terms', type: 'text', max: 500 },
        { name: 'source_retrieved_at', type: 'date' }, { name: 'cursor', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] },
        { name: 'quota_used', type: 'number', min: 0, noDecimal: true, default: 0 }, { name: 'quota_limit', type: 'number', min: 1, noDecimal: true, default: 10000 },
        { name: 'total', type: 'number', min: 0, noDecimal: true, default: 0 }, { name: 'last_error', type: 'text', max: 240 }, { name: 'updated_at', type: 'date' },
      ], indexes: ['CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)'],
    })
    app.save(imports)
  }
  let importsChanged = makePrivate(imports)
  const importFields = [
    ['batch_key', 'text', { required: true, min: 1, max: 80 }],
    ['source_fingerprint', 'text', { required: true, min: 64, max: 64 }],
    ['source_url', 'text', { required: false, max: 500 }],
    ['source_terms', 'text', { required: false, max: 500 }],
    ['source_retrieved_at', 'date', {}],
    ['cursor', 'number', { required: false, min: 0, noDecimal: true, default: 0 }],
    ['status', 'select', { required: true, maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] }],
    ['quota_used', 'number', { required: false, min: 0, noDecimal: true, default: 0 }],
    ['quota_limit', 'number', { required: false, min: 1, noDecimal: true, default: 10000 }],
    ['total', 'number', { required: false, min: 0, noDecimal: true, default: 0 }],
    ['last_error', 'text', { required: false, max: 240 }],
    ['updated_at', 'date', {}],
  ]
  for (const [name, type, options] of importFields) importsChanged = ensureField(imports, name, type, options) || importsChanged
  importsChanged = ensureIndex(imports, 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)') || importsChanged
  if (importsChanged) app.save(imports)

  const chunks = find('karaoke_catalog_import_chunks')
  if (!chunks) {
    app.save(new Collection({
      name: 'karaoke_catalog_import_chunks', type: 'base', listRule: null, viewRule: null,
      createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'import', type: 'relation', required: true, collectionId: imports.id, maxSelect: 1 },
        { name: 'offset', type: 'number', min: 0, noDecimal: true },
        { name: 'chunk_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'item_count', type: 'number', required: true, min: 1, noDecimal: true }, { name: 'payload_json', type: 'json' },
      ], indexes: ['CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)'],
    }))
  } else {
    let chunksChanged = makePrivate(chunks)
    const chunkFields = [
      ['import', 'relation', { required: true, collectionId: imports.id, maxSelect: 1 }],
      ['offset', 'number', { required: false, min: 0, noDecimal: true }],
      ['chunk_fingerprint', 'text', { required: true, min: 64, max: 64 }],
      ['item_count', 'number', { required: true, min: 1, noDecimal: true }],
      ['payload_json', 'json', {}],
    ]
    for (const [name, type, options] of chunkFields) chunksChanged = ensureField(chunks, name, type, options) || chunksChanged
    chunksChanged = ensureIndex(chunks, 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)') || chunksChanged
    try {
      const importRelation = chunks.fields.getByName('import')
      if (importRelation.type === 'relation' && importRelation.collectionId !== imports.id) {
        importRelation.collectionId = imports.id
        chunksChanged = true
      }
    } catch (_) {}
    if (chunksChanged) app.save(chunks)
  }
}, () => {})
