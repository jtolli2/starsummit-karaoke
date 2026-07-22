// Server-only durable fallback coordination; all browser access is via hooks.
migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const add = (name, fields, indexes) => { if (find(name)) return; app.save(new Collection({ name, type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields, indexes })) }
  const parties = find('karaoke_parties'); const guests = find('karaoke_guest_identities'); const cache = find('karaoke_youtube_search_cache')
  add('karaoke_youtube_search_claims', [
    { name: 'query_hash', type: 'text', required: true, min: 32, max: 128 }, { name: 'policy_version', type: 'text', required: true, max: 32 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['in_progress', 'ready', 'failed'] }, { name: 'owner_token', type: 'text', max: 96 }, { name: 'lease_expires_at', type: 'date' }, { name: 'payload_json', type: 'json' }, { name: 'spent_units', type: 'number', min: 0, noDecimal: true, default: 0 },
  ], ['CREATE UNIQUE INDEX idx_karaoke_youtube_search_claim_query ON karaoke_youtube_search_claims (query_hash, policy_version)'])
  add('karaoke_youtube_search_access', [
    { name: 'party', type: 'relation', required: true, collectionId: parties.id, maxSelect: 1 }, { name: 'guest', type: 'relation', required: true, collectionId: guests.id, maxSelect: 1 }, { name: 'claim', type: 'relation', required: true, collectionId: find('karaoke_youtube_search_claims').id, maxSelect: 1 }, { name: 'expires_at', type: 'date', required: true },
  ], ['CREATE UNIQUE INDEX idx_karaoke_youtube_search_access_scope ON karaoke_youtube_search_access (party, guest, claim)'])
  add('karaoke_fallback_rate_limits', [
    { name: 'party', type: 'relation', required: true, collectionId: parties.id, maxSelect: 1 }, { name: 'guest', type: 'relation', required: true, collectionId: guests.id, maxSelect: 1 }, { name: 'day_key', type: 'text', required: true, max: 16 }, { name: 'count', type: 'number', required: true, min: 0, noDecimal: true, default: 0 },
  ], ['CREATE UNIQUE INDEX idx_karaoke_fallback_rate_scope ON karaoke_fallback_rate_limits (party, guest, day_key)'])
}, () => {})
