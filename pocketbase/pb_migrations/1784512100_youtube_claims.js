migrate((app) => {
  let claims = app.findCollectionByNameOrId('karaoke_youtube_claims')
  if (!claims) {
    claims = new Collection({ name: 'karaoke_youtube_claims', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: 'claim_key', type: 'text', required: true, max: 180 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['in_progress', 'ready', 'complete', 'failed'] },
        { name: 'batch_key', type: 'text', required: true, max: 80 },
        { name: 'quota_day_key', type: 'text', required: true, max: 16 },
        { name: 'reserved_units', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'spent_units', type: 'number', min: 0, noDecimal: true, default: 0 },
        { name: 'payload_json', type: 'json' },
        { name: 'owner_token', type: 'text', max: 80 },
        { name: 'lease_expires_at', type: 'date' },
        { name: 'error_code', type: 'text', max: 120 },
      ], indexes: ['CREATE UNIQUE INDEX idx_karaoke_youtube_claim_key ON karaoke_youtube_claims (claim_key)'] })
    app.save(claims)
  } else {
    const add = (name, type, options = {}) => { try { claims.fields.getByName(name); return } catch (_) {} claims.fields.add(new Field({ name, type, ...options })) }
    add('quota_day_key', 'text', { required: true, max: 16 }); add('reserved_units', 'number', { min: 0, noDecimal: true, default: 0 }); add('spent_units', 'number', { min: 0, noDecimal: true, default: 0 }); add('payload_json', 'json'); add('error_code', 'text', { max: 120 }); add('owner_token', 'text', { max: 80 }); add('lease_expires_at', 'date'); claims.fields.getByName('status').values = ['in_progress', 'ready', 'complete', 'failed']; app.save(claims)
  }
}, (app) => { const c = app.findCollectionByNameOrId('karaoke_youtube_claims'); if (c) app.delete(c) })
