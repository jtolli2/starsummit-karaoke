// Repair partial retained checkpoint collections left by catalog migrations
// that treated an undefined PocketBase field lookup as an exception. This is
// additive: it creates only missing collections/fields, restores private
// rules, and rebinds metadata without changing import or chunk records.
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
  const ensure = (collection, name, type, options = {}) => {
    let field = null
    try { field = collection.fields.getByName(name) } catch (_) {}
    if (field) return false
    collection.fields.add(new Field({ name, type, ...options }))
    return true
  }
  const importIndex = 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_batch ON karaoke_catalog_imports (batch_key)'
  const chunkIndex = 'CREATE UNIQUE INDEX idx_karaoke_catalog_import_chunk ON karaoke_catalog_import_chunks (import, offset)'
  const ensureIndex = (collection, sql) => {
    if (collection.indexes.includes(sql)) return
    // Do not hide duplicate retained checkpoint keys. Keeping records intact is
    // important, but proceeding without the uniqueness invariant would make
    // resumable imports unsafe; fail this migration clearly for operator repair.
    collection.indexes.push(sql)
    app.save(collection)
  }

  const importFields = [
    ['batch_key', 'text', { required: true, min: 1, max: 80 }],
    // Do not make a newly-added provenance field required on a partial
    // retained collection: an older row cannot be truthfully reconstructed.
    ['source_fingerprint', 'text', { min: 64, max: 64 }],
    ['source_url', 'text', { max: 500 }], ['source_terms', 'text', { max: 500 }],
    ['source_retrieved_at', 'date', {}], ['cursor', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['status', 'select', { maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] }],
    ['quota_used', 'number', { min: 0, noDecimal: true, default: 0 }], ['quota_limit', 'number', { min: 1, noDecimal: true, default: 10000 }],
    ['total', 'number', { min: 0, noDecimal: true, default: 0 }], ['last_error', 'text', { max: 240 }], ['updated_at', 'date', {}],
  ]
  const canonicalImportFields = [
    ['batch_key', 'text', { required: true, min: 1, max: 80 }],
    ['source_fingerprint', 'text', { required: true, min: 64, max: 64 }],
    ['source_url', 'text', { max: 500 }], ['source_terms', 'text', { max: 500 }],
    ['source_retrieved_at', 'date', {}], ['cursor', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['status', 'select', { required: true, maxSelect: 1, values: ['pending', 'running', 'paused', 'complete', 'failed'] }],
    ['quota_used', 'number', { min: 0, noDecimal: true, default: 0 }], ['quota_limit', 'number', { min: 1, noDecimal: true, default: 10000 }],
    ['total', 'number', { min: 0, noDecimal: true, default: 0 }], ['last_error', 'text', { max: 240 }], ['updated_at', 'date', {}],
  ]
  let imports = find('karaoke_catalog_imports')
  if (!imports) {
    imports = new Collection({ name: 'karaoke_catalog_imports', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: canonicalImportFields.map(([name, type, options]) => ({ name, type, ...options })), indexes: [importIndex] })
    app.save(imports)
  } else {
    let changed = makePrivate(imports)
    for (const [name, type, options] of importFields) changed = ensure(imports, name, type, options) || changed
    if (changed) app.save(imports)
    ensureIndex(imports, importIndex)
  }

  const chunkFields = [
    ['import', 'relation', { required: true, collectionId: imports.id, maxSelect: 1 }],
    ['offset', 'number', { min: 0, noDecimal: true }],
    ['chunk_fingerprint', 'text', { min: 64, max: 64 }],
    ['item_count', 'number', { min: 1, noDecimal: true }], ['payload_json', 'json', {}],
  ]
  const canonicalChunkFields = [
    ['import', 'relation', { required: true, collectionId: imports.id, maxSelect: 1 }],
    ['offset', 'number', { min: 0, noDecimal: true }],
    ['chunk_fingerprint', 'text', { required: true, min: 64, max: 64 }],
    ['item_count', 'number', { required: true, min: 1, noDecimal: true }], ['payload_json', 'json', {}],
  ]
  let chunks = find('karaoke_catalog_import_chunks')
  if (!chunks) {
    chunks = new Collection({ name: 'karaoke_catalog_import_chunks', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: canonicalChunkFields.map(([name, type, options]) => ({ name, type, ...options })), indexes: [chunkIndex] })
    app.save(chunks)
    return
  }
  let changed = makePrivate(chunks)
  for (const [name, type, options] of chunkFields) changed = ensure(chunks, name, type, options) || changed
  try {
    const relation = chunks.fields.getByName('import')
    if (relation && relation.type === 'relation' && relation.collectionId !== imports.id) { relation.collectionId = imports.id; changed = true }
  } catch (_) {}
  if (changed) app.save(chunks)
  ensureIndex(chunks, chunkIndex)
}, () => {})
