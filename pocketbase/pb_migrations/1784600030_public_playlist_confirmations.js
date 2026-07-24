// Additive records for admin-confirmed public playlist previews and safe bulk approval.
migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const ensure = (name, fields, indexes = []) => {
    if (find(name)) return
    app.save(new Collection({ name, type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: fields.map(([n, t, o]) => ({ name: n, type: t, ...o })), indexes }))
  }
  ensure('karaoke_playlist_confirmations', [
    ['token_digest', 'text', { required: true, max: 64 }], ['admin_id', 'text', { required: true, max: 120 }],
    ['playlist_id', 'text', { required: true, max: 120 }], ['owner_channel_id', 'text', { max: 120 }],
    ['visibility', 'text', { max: 24 }], ['snapshot_fingerprint', 'text', { required: true, max: 64 }],
    ['ordered_video_ids_json', 'json'], ['expected_counts_json', 'json'], ['policy_version', 'text', { max: 40 }],
    ['expires_at', 'date', { required: true }], ['used_at', 'date'], ['status', 'select', { values: ['issued', 'used', 'expired', 'rejected'], maxSelect: 1 }],
  ], ['CREATE UNIQUE INDEX idx_karaoke_playlist_confirmation_digest ON karaoke_playlist_confirmations (token_digest)'])
  ensure('karaoke_catalog_selection_snapshots', [
    ['digest', 'text', { required: true, max: 64 }], ['admin_id', 'text', { required: true, max: 120 }],
    ['source_scope', 'text', { required: true, max: 240 }], ['filter_json', 'json'], ['record_ids_json', 'json'],
    ['record_versions_json', 'json'], ['policy_version', 'text', { max: 40 }], ['expires_at', 'date', { required: true }],
    ['status', 'select', { values: ['issued', 'committed', 'expired'], maxSelect: 1 }],
  ], ['CREATE UNIQUE INDEX idx_karaoke_selection_snapshot_digest ON karaoke_catalog_selection_snapshots (digest)'])
  ensure('karaoke_catalog_approval_operations', [
    ['operation_id', 'text', { required: true, max: 120 }], ['selection_digest', 'text', { required: true, max: 64 }],
    ['admin_id', 'text', { required: true, max: 120 }], ['status', 'select', { values: ['running', 'complete', 'partial', 'failed'], maxSelect: 1 }],
    ['cursor', 'number', { min: 0, noDecimal: true }], ['approved_count', 'number', { min: 0, noDecimal: true }],
    ['excluded_json', 'json'], ['audit_json', 'json'], ['updated_at', 'date'],
  ], ['CREATE UNIQUE INDEX idx_karaoke_approval_operation_id ON karaoke_catalog_approval_operations (operation_id)'])
}, () => {})
