migrate((app) => {
  if (app.findCollectionByNameOrId('karaoke_youtube_quota')) return
  app.save(new Collection({
    name: 'karaoke_youtube_quota', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'day_key', type: 'text', required: true, max: 16 },
      { name: 'quota_limit', type: 'number', required: true, min: 1, noDecimal: true, default: 10000 },
      { name: 'reserved', type: 'number', min: 0, noDecimal: true, default: 0 },
      { name: 'spent', type: 'number', min: 0, noDecimal: true, default: 0 },
    ], indexes: ['CREATE UNIQUE INDEX idx_karaoke_youtube_quota_day ON karaoke_youtube_quota (day_key)'],
  }))
}, (app) => { const row = app.findCollectionByNameOrId('karaoke_youtube_quota'); if (row) app.delete(row) })
