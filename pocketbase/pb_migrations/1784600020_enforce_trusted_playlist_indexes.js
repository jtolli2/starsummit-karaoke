// Required uniqueness guarantees for replay coalescing and the per-operation
// ledger. Deliberately fail closed if retained duplicate data prevents an
// index: the operator can inspect retained rows, but the importer must not run
// with ambiguous claims or operation aggregates.
migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const requireIndex = (name, sql) => {
    const collection = find(name)
    if (!collection) throw new Error(`trusted_playlist_schema_missing:${name}`)
    if (collection.indexes.includes(sql)) return
    collection.indexes.push(sql)
    app.save(collection)
  }
  requireIndex('karaoke_youtube_operations', 'CREATE UNIQUE INDEX idx_karaoke_youtube_operation_class ON karaoke_youtube_operations (day_key, operation_class, source_key, snapshot_fingerprint)')
  requireIndex('karaoke_playlist_snapshots', 'CREATE UNIQUE INDEX idx_karaoke_playlist_snapshot ON karaoke_playlist_snapshots (source_key, page_token, snapshot_fingerprint)')
  requireIndex('karaoke_playlist_claims', 'CREATE UNIQUE INDEX idx_karaoke_playlist_claim_key ON karaoke_playlist_claims (claim_key)')
}, () => {})
