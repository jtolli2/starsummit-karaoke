migrate((app) => {
  const chunks = app.findCollectionByNameOrId('karaoke_catalog_import_chunks')
  if (chunks) { try { chunks.fields.getByName('payload_json') } catch (_) { chunks.fields.add(new Field({ name: 'payload_json', type: 'json' })); app.save(chunks) } }
}, () => {})
