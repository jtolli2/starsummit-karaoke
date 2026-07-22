// PocketBase 0.39.7 exposes Field.type() as a method. Repair only the retained
// checkpoint offset's required flag; records, indexes, and all other schema
// properties remain untouched.
migrate((app) => {
  let chunks = null
  try { chunks = app.findCollectionByNameOrId('karaoke_catalog_import_chunks') } catch (_) {}
  if (!chunks) return

  let offset = null
  try { offset = chunks.fields.getByName('offset') } catch (_) {}
  if (!offset) return

  let type = ''
  try { type = typeof offset.type === 'function' ? String(offset.type() || '') : String(offset.type || '') } catch (_) { return }
  if (type !== 'number' || offset.required !== true) return

  offset.required = false
  app.save(chunks)
}, () => {})
