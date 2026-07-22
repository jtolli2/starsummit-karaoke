// Forward-only claim audit metadata. Existing rows remain untouched.
migrate((app) => {
  let claims = null
  try { claims = app.findCollectionByNameOrId('karaoke_youtube_claims') } catch (_) {}
  if (!claims) return
  const fields = [
    ['source_fingerprint', 'text', { max: 80 }],
    ['chunk_fingerprint', 'text', { max: 80 }],
    ['payload_digest', 'text', { max: 80 }],
    ['ordered_identity_json', 'json', {}],
    ['reservation_released_at', 'date', {}],
    ['lifecycle_version', 'number', { min: 1, noDecimal: true, default: 1 }],
    ['lifecycle_reason', 'text', { max: 240 }],
    ['replay_count', 'number', { min: 0, noDecimal: true, default: 0 }],
    ['audit_json', 'json', {}],
  ]
  let changed = false
  for (const [name, type, options] of fields) {
    let existing = null
    try { existing = claims.fields.getByName(name) || null } catch (_) {}
    if (!existing) { claims.fields.add(new Field({ name, type, ...options })); changed = true }
  }
  if (changed) app.save(claims)
}, () => {})
