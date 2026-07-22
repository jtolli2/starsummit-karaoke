// Catalog provenance/review metadata and resumable importer state.
migrate((app) => {
  const find = (name) => {
    try { return app.findCollectionByNameOrId(name) } catch (_) { return null }
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
  const add = (name, type, options = {}) => {
    try { songs.fields.getByName(name); return } catch (_) {}
    songs.fields.add(new Field({ name, type, ...options }))
  }
  add('source', 'text', { max: 80 })
  add('source_query', 'text', { max: 160 })
  add('source_url', 'text', { max: 500 })
  add('source_retrieved_at', 'date')
  add('source_rank', 'number', { min: 0, noDecimal: true })
  add('source_terms', 'text', { max: 500 })
  add('classification', 'select', { maxSelect: 1, values: ['karaoke', 'original', 'lyric', 'live', 'cover', 'fallback_lyric', 'fallback_audio', 'other', 'unknown'], required: true, default: 'unknown' })
  add('classification_confidence', 'number', { min: 0, max: 1 })
  add('review_status', 'select', { maxSelect: 1, values: ['unreviewed', 'approved', 'rejected', 'needs_review'], required: true, default: 'unreviewed' })
  add('reviewed_at', 'date')
  add('reviewed_by', 'text', { max: 120 })
  add('replacement_youtube_id', 'text', { min: 11, max: 11 })
  add('replacement_reason', 'text', { max: 240 })
  add('metadata_json', 'json')
  add('normalized_title', 'text', { max: 240 })
  add('normalized_artist', 'text', { max: 160 })
  add('identity_key', 'text', { max: 420 })
  add('alternatives_json', 'json')
  add('review_history_json', 'json')
  add('import_batch', 'text', { max: 80 })
  add('imported_at', 'date')
  app.save(songs)

  if (!find('karaoke_catalog_imports')) {
    app.save(new Collection({
      name: 'karaoke_catalog_imports', type: 'base', listRule: null, viewRule: null,
      createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'batch_key', type: 'text', required: true, min: 1, max: 80 },
        { name: 'source_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'source_url', type: 'text', max: 500 },
        { name: 'source_terms', type: 'text', max: 500 },
        { name: 'source_retrieved_at', type: 'date' },
        { name: 'cursor', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] },
        { name: 'quota_used', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'quota_limit', type: 'number', min: 1, noDecimal: true, default: 10000 },
        { name: 'total', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'last_error', type: 'text', max: 240 },
        { name: 'updated_at', type: 'date' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)'],
    }))
    const imports = find('karaoke_catalog_imports')
    app.save(new Collection({
      name: 'karaoke_catalog_import_chunks', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'import', type: 'relation', required: true, collectionId: imports.id, maxSelect: 1 },
        { name: 'offset', type: 'number', required: true, min: 0, noDecimal: true },
        { name: 'chunk_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'item_count', type: 'number', required: true, min: 1, noDecimal: true },
        { name: 'payload_json', type: 'json' },
      ], indexes: ['CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)'],
    }))
  }
}, (app) => {
  const find = (name) => {
    try { return app.findCollectionByNameOrId(name) } catch (_) { return null }
  }
  const chunks = find('karaoke_catalog_import_chunks'); if (chunks) app.delete(chunks)
  const imports = find('karaoke_catalog_imports'); if (imports) app.delete(imports)
})
