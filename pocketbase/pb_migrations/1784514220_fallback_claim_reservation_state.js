migrate((app) => {
  let claims = null
  try { claims = app.findCollectionByNameOrId('karaoke_youtube_search_claims') } catch (_) {}
  if (!claims) return
  const add = (name, type, options) => { try { if (!claims.fields.getByName(name)) claims.fields.add(new Field({ name, type, ...options })) } catch (_) {} }
  add('reserved_units', 'number', { min: 0, noDecimal: true, default: 0 })
  add('quota_day_key', 'text', { max: 16 })
  add('external_started_at', 'date')
  app.save(claims)
}, () => {})
