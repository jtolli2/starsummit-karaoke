// PocketBase treats numeric zero as blank for required fields. The first
// catalog checkpoint uses offset zero, so repair retained schemas that still
// mark this field as required without rewriting any records or other schema
// settings.
migrate((app) => {
  let chunks = null
  try { chunks = app.findCollectionByNameOrId('karaoke_catalog_import_chunks') } catch (_) {}
  if (!chunks) return

  let offset = null
  try { offset = chunks.fields.getByName('offset') } catch (_) {}
  if (!offset || offset.type !== 'number' || !offset.required) return

  offset.required = false
  app.save(chunks)
}, () => {})
