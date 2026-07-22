// Make payload checkpointing safe on a retained volume where the earlier
// catalog migration is recorded but its import/chunk collections are missing.
migrate((app) => {
  const find = (name) => {
    try { return app.findCollectionByNameOrId(name) } catch (_) { return null }
  }
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
  const importIndex = 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)'
  const chunkIndex = 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)'

  let imports = find('karaoke_catalog_imports')
  if (!imports) {
    imports = new Collection({
      name: 'karaoke_catalog_imports', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'batch_key', type: 'text', required: true, min: 1, max: 80 },
        { name: 'source_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'source_url', type: 'text', max: 500 }, { name: 'source_terms', type: 'text', max: 500 },
        { name: 'source_retrieved_at', type: 'date' }, { name: 'cursor', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] },
        { name: 'quota_used', type: 'number', min: 0, noDecimal: true, default: 0 }, { name: 'quota_limit', type: 'number', min: 1, noDecimal: true, default: 10000 },
        { name: 'total', type: 'number', min: 0, noDecimal: true, default: 0 }, { name: 'last_error', type: 'text', max: 240 }, { name: 'updated_at', type: 'date' },
      ], indexes: [importIndex],
    })
    app.save(imports)
  }

  let chunks = find('karaoke_catalog_import_chunks')
  if (!chunks) {
    chunks = new Collection({
      name: 'karaoke_catalog_import_chunks', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'import', type: 'relation', required: true, collectionId: imports.id, maxSelect: 1 },
        { name: 'offset', type: 'number', required: true, min: 0, noDecimal: true },
        { name: 'chunk_fingerprint', type: 'text', required: true, min: 64, max: 64 },
        { name: 'item_count', type: 'number', required: true, min: 1, noDecimal: true }, { name: 'payload_json', type: 'json' },
      ], indexes: [chunkIndex],
    })
    app.save(chunks)
    return
  }

  let changed = makePrivate(chunks)
  for (const [name, type, options] of [
    ['import', 'relation', { required: true, collectionId: imports.id, maxSelect: 1 }],
    ['offset', 'number', { required: true, min: 0, noDecimal: true }],
    ['chunk_fingerprint', 'text', { required: true, min: 64, max: 64 }],
    ['item_count', 'number', { required: true, min: 1, noDecimal: true }],
    ['payload_json', 'json', {}],
  ]) changed = ensureField(chunks, name, type, options) || changed
  try {
    const relation = chunks.fields.getByName('import')
    if (relation.type === 'relation' && relation.collectionId !== imports.id) {
      relation.collectionId = imports.id
      changed = true
    }
  } catch (_) {}
  if (changed) app.save(chunks)

  if (!chunks.indexes.includes(chunkIndex)) {
    const indexes = chunks.indexes.slice()
    chunks.indexes.push(chunkIndex)
    try { app.save(chunks) } catch (_) { chunks.indexes = indexes }
  }
}, () => {})
