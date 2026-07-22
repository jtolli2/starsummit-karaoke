migrate((app) => {
  let claims = null
  try { claims = app.findCollectionByNameOrId('karaoke_youtube_search_claims') } catch (_) {}
  if (!claims) return
  try { if (!claims.fields.getByName('expires_at')) claims.fields.add(new Field({ name: 'expires_at', type: 'date' })) } catch (_) {}
  app.save(claims)
}, () => {})
