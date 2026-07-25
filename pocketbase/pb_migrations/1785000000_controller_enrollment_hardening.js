// Additive controller enrollment grant hardening. Existing hashes remain valid;
// plaintext tokens are never persisted and rollback intentionally leaves data intact.
migrate((app) => {
  const grants = app.findCollectionByNameOrId('controller_enrollment_grants')
  if (!grants) return
  const add = (name, field) => {
    try { if (!grants.fields.getByName(name)) grants.fields.add(new Field(field)) } catch (_) { grants.fields.add(new Field(field)) }
  }
  add('expected_server_host', { name: 'expected_server_host', type: 'text', required: true, max: 255 })
  add('destination', { name: 'destination', type: 'text', required: true, max: 255 })
  add('revoked_at', { name: 'revoked_at', type: 'date' })
  add('operator_id', { name: 'operator_id', type: 'text', max: 120 })
  add('short_code_hash', { name: 'short_code_hash', type: 'text', min: 64, max: 64 })
  const devices = app.findCollectionByNameOrId('controller_devices')
  if (devices) add('redeemed_device', { name: 'redeemed_device', type: 'relation', collectionId: devices.id, maxSelect: 1 })
  try { grants.indexes.add('CREATE INDEX idx_controller_grants_operator_active ON controller_enrollment_grants (operator_id, expires_at, used_at, revoked_at)') } catch (_) {}
  try { grants.indexes.add('CREATE UNIQUE INDEX idx_controller_grants_short_code_hash ON controller_enrollment_grants (short_code_hash)') } catch (_) {}
  app.save(grants)
}, () => {})
