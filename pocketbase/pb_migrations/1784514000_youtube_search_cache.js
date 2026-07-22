// Durable, server-only fallback search cache. No public collection rules.
migrate((app) => {
  let cache = null
  try { cache = app.findCollectionByNameOrId('karaoke_youtube_search_cache') } catch (_) {}
  if (cache) return
  app.save(new Collection({
    name: 'karaoke_youtube_search_cache', type: 'base',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'query_hash', type: 'text', required: true, min: 32, max: 128 },
      { name: 'normalized_query', type: 'text', required: true, min: 2, max: 80 },
      { name: 'payload_json', type: 'json', required: true },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'created_at', type: 'date', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_karaoke_youtube_search_cache_query ON karaoke_youtube_search_cache (query_hash)'],
  }))
}, (app) => {
  // Forward-only safety: retained cache and quota records are never deleted by
  // a rollback in production. PocketBase requires a down callback, so leave it
  // intentionally empty.
})
