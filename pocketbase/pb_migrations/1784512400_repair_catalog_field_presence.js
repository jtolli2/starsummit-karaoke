// PocketBase 0.39 returns undefined, rather than throwing, when a collection
// field is absent. Earlier catalog migrations treated that lookup as throwing,
// so an already-created karaoke_songs collection could miss all provenance and
// review fields. Add only absent metadata fields, and backfill only blank
// legacy defaults so existing operator classification and review choices stay
// intact.
migrate((app) => {
  let songs = null
  try { songs = app.findCollectionByNameOrId('karaoke_songs') } catch (_) {}
  if (!songs) return

  const add = (name, type, options = {}) => {
    let field = null
    try { field = songs.fields.getByName(name) } catch (_) {}
    if (field) return false
    songs.fields.add(new Field({ name, type, ...options }))
    return true
  }

  let changed = false
  for (const [name, type, options] of [
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
  ]) changed = add(name, type, options) || changed
  if (changed) app.save(songs)

  let imports = null
  try { imports = app.findCollectionByNameOrId('karaoke_catalog_imports') } catch (_) {}
  if (imports) {
    let digest = null
    try { digest = imports.fields.getByName('final_digest') } catch (_) {}
    if (!digest) { imports.fields.add(new Field({ name: 'final_digest', type: 'text', max: 64 })); app.save(imports) }
  }

  // Defaults on a newly-added PocketBase field are not a reliable backfill for
  // retained records. Required select fields must therefore be populated
  // explicitly before any later operator save. Only blank values are changed;
  // nonblank classifications and review decisions are preserved.
  const value = (record, name) => {
    try { return String(record.getString(name) || '') } catch (_) {}
    try { return String(record.get(name) || '') } catch (_) {}
    return ''
  }
  while (true) {
    const rows = app.findRecordsByFilter(
      'karaoke_songs',
      'classification = "" || review_status = ""',
      '+id',
      500,
      0,
    )
    if (!rows.length) break
    for (const record of rows) {
      let repaired = false
      if (!value(record, 'classification')) { record.set('classification', 'unknown'); repaired = true }
      if (!value(record, 'review_status')) { record.set('review_status', 'unreviewed'); repaired = true }
      if (repaired) app.save(record)
    }
    if (rows.length < 500) break
  }

  // Correct the original chunk schema without changing any chunks. PocketBase
  // considers numeric zero blank for `required` fields, but offset zero is the
  // first valid checkpoint.
  let chunks = null
  try { chunks = app.findCollectionByNameOrId('karaoke_catalog_import_chunks') } catch (_) {}
  if (!chunks) return
  let offsetField = null
  try { offsetField = chunks.fields.getByName('offset') } catch (_) {}
  const offsetType = offsetField && (typeof offsetField.type === 'function' ? offsetField.type() : offsetField.type)
  if (offsetField && offsetType === 'number' && offsetField.required) {
    offsetField.required = false
    app.save(chunks)
  }
}, () => {})
