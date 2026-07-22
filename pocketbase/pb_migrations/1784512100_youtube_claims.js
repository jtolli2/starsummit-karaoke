// Recreate a missing claims ledger and extend a partial one without touching
// claim records. This is needed when retained migration history is irregular.
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
  const index = 'CREATE UNIQUE INDEX idx_karaoke_youtube_claim_key ON karaoke_youtube_claims (claim_key)'
  const fields = [
    ['claim_key', 'text', { required: true, max: 180 }],
    ['status', 'select', { required: true, maxSelect: 1, values: ['in_progress', 'ready', 'complete', 'failed'] }],
    ['batch_key', 'text', { required: true, max: 80 }],
    ['quota_day_key', 'text', { required: true, max: 16 }],
    ['reserved_units', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['spent_units', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['payload_json', 'json', {}],
    ['owner_token', 'text', { max: 80 }],
    ['lease_expires_at', 'date', {}],
    ['error_code', 'text', { max: 120 }],
  ]

  let claims = find('karaoke_youtube_claims')
  if (!claims) {
    claims = new Collection({
      name: 'karaoke_youtube_claims', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: fields.map(([name, type, options]) => ({ name, type, ...options })), indexes: [index],
    })
    app.save(claims)
    return
  }

  let changed = makePrivate(claims)
  for (const [name, type, options] of fields) changed = ensureField(claims, name, type, options) || changed
  // Existing select fields may have been created by an earlier partial run.
  // Extending the allowed values is metadata-only and leaves claim rows intact.
  try {
    const status = claims.fields.getByName('status')
    const values = ['in_progress', 'ready', 'complete', 'failed']
    if (status.type === 'select' && JSON.stringify(status.values) !== JSON.stringify(values)) {
      status.values = values
      changed = true
    }
  } catch (_) {}
  if (changed) app.save(claims)

  if (!claims.indexes.includes(index)) {
    const indexes = claims.indexes.slice()
    claims.indexes.push(index)
    try { app.save(claims) } catch (_) { claims.indexes = indexes }
  }
}, (app) => {
  let claims = null; try { claims = app.findCollectionByNameOrId('karaoke_youtube_claims') } catch (_) {}
  if (claims) app.delete(claims)
})
