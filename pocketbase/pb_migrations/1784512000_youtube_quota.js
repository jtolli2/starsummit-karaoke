// A retained database can have migration history without this collection after
// a partial restore. Keep the quota ledger private and repair it additively.
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
  const index = 'CREATE UNIQUE INDEX idx_karaoke_youtube_quota_day ON karaoke_youtube_quota (day_key)'

  let quota = find('karaoke_youtube_quota')
  if (!quota) {
    quota = new Collection({
      name: 'karaoke_youtube_quota', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'day_key', type: 'text', required: true, max: 16 },
        { name: 'quota_limit', type: 'number', required: true, min: 1, noDecimal: true, default: 10000 },
        { name: 'reserved', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'spent', type: 'number', min: 0, noDecimal: true, default: 0 },
      ], indexes: [index],
    })
    app.save(quota)
    return
  }

  let changed = makePrivate(quota)
  for (const [name, type, options] of [
    ['day_key', 'text', { required: true, max: 16 }],
    ['quota_limit', 'number', { required: true, min: 1, noDecimal: true, default: 10000 }],
    ['reserved', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['spent', 'number', { min: 0, noDecimal: true, default: 0 }],
  ]) changed = ensureField(quota, name, type, options) || changed
  if (changed) app.save(quota)

  // Do not fail a retained deployment merely because historical duplicate
  // quota rows make the desired unique index unsafe. The records remain
  // untouched; an operator can reconcile duplicates before adding the index.
  if (!quota.indexes.includes(index)) {
    const indexes = quota.indexes.slice()
    quota.indexes.push(index)
    try { app.save(quota) } catch (_) { quota.indexes = indexes }
  }
}, (app) => {
  let row = null; try { row = app.findCollectionByNameOrId('karaoke_youtube_quota') } catch (_) {}
  if (row) app.delete(row)
})
