// Forward-only repair for retained staging databases that already applied the
// earlier catalog migrations. Adds only the server-computed completion digest.
migrate((app) => {
  let imports = null
  try { imports = app.findCollectionByNameOrId('karaoke_catalog_imports') } catch (_) {}
  if (!imports) return
  let field = null
  try { field = imports.fields.getByName('final_digest') } catch (_) {}
  if (field) return
  imports.fields.add(new Field({ name: 'final_digest', type: 'text', max: 64 }))
  app.save(imports)
}, () => {})
