// Durable binding fields for replay-safe previews and chunked approval operations.
migrate((app) => {
  const add = (name, fields) => {
    let collection
    try { collection = app.findCollectionByNameOrId(name) } catch (_) { return }
    let changed = false
    for (const field of fields) {
      try { if (!collection.fields.getByName(field.name)) { collection.fields.add(new Field(field)); changed = true } } catch (_) {}
    }
    if (changed) app.save(collection)
  }
  add('karaoke_playlist_confirmations', [
    { name: 'etag', type: 'text', max: 240 },
    { name: 'page_token', type: 'text', max: 240 },
    { name: 'import_cap', type: 'number', min: 0, noDecimal: true },
  ])
  add('karaoke_playlist_snapshots', [
    { name: 'playlist_id', type: 'text', max: 120 }, { name: 'owner_channel_id', type: 'text', max: 120 },
    { name: 'owner_channel_title', type: 'text', max: 240 }, { name: 'visibility', type: 'text', max: 24 },
    { name: 'etag', type: 'text', max: 240 }, { name: 'expected_counts_json', type: 'json' },
    { name: 'import_cap', type: 'number', min: 0, noDecimal: true },
  ])
  add('karaoke_catalog_selection_snapshots', [
    { name: 'source_filter_digest', type: 'text', max: 64 },
  ])
}, () => {})
