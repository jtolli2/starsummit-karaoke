migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const addFields = (collection, fields) => {
    let changed = false
    fields.forEach(([name, type, options = {}]) => {
      let field = null
      try { field = collection.fields.getByName(name) } catch (_) {}
      if (!field) { collection.fields.add(new Field({ name, type, ...options })); changed = true }
    })
    if (changed) app.save(collection)
  }
  const songs = find('karaoke_songs')
  if (songs) addFields(songs, [
    ['binding_kind', 'text', { max: 48 }],
    ['binding_playlist_id', 'text', { max: 64 }],
    ['binding_input_digest', 'text', { max: 64 }],
    ['binding_row_digest', 'text', { max: 64 }],
  ])
  let jobs = find('karaoke_legacy_playlist_jobs')
  if (!jobs) {
    jobs = new Collection({ name: 'karaoke_legacy_playlist_jobs', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [], indexes: [] })
    app.save(jobs)
  }
  addFields(jobs, [
    ['job_key', 'text', { required: true, max: 120 }],
    ['playlist_id', 'text', { required: true, max: 64 }],
    ['input_digest', 'text', { required: true, max: 64 }],
    ['rows_json', 'json'],
    ['initiated_by', 'text', { max: 80 }],
    ['cursor', 'number', { noDecimal: true, default: 0 }],
    ['status', 'select', { required: true, maxSelect: 1, values: ['pending', 'running', 'complete', 'failed'], default: 'pending' }],
    ['lease_token', 'text', { max: 80 }],
    ['lease_expires_at', 'date'],
    ['report_json', 'json'],
    ['last_error', 'text', { max: 160 }],
    ['updated_at', 'date'],
  ])
  const uniqueIndex = 'CREATE UNIQUE INDEX idx_legacy_playlist_job_key ON karaoke_legacy_playlist_jobs (job_key)'
  const indexes = Array.isArray(jobs.indexes) ? jobs.indexes : []
  if (!indexes.includes(uniqueIndex)) { jobs.indexes = indexes.concat(uniqueIndex); app.save(jobs) }
}, (app) => {})
