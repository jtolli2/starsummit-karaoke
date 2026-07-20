// PocketBase 0.39.x migration for the native controller protocol.
// Direct writes are locked to superusers; protocol hooks are the only writers.
migrate((app) => {
  let users = app.findCollectionByNameOrId('users')
  if (!users) {
    users = new Collection({
      name: 'users',
      type: 'auth',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: 'role = "tablet_admin" && revoked = false',
      fields: [
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['tablet_admin'] },
        { name: 'revoked', type: 'bool', default: false },
      ],
    })
    app.save(users)
  } else {
    let roleField
    try { roleField = users.fields.getByName('role') } catch (_) { roleField = null }
    if (!roleField) users.fields.add(new Field({ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['tablet_admin'] }))
    let revokedField
    try { revokedField = users.fields.getByName('revoked') } catch (_) { revokedField = null }
    if (!revokedField) users.fields.add(new Field({ name: 'revoked', type: 'bool', default: false }))
    users.authRule = 'role = "tablet_admin" && revoked = false'
    app.save(users)
  }

  const devices = new Collection({
    name: 'controller_devices',
    type: 'auth',
    listRule: '@request.auth.id != "" && id = @request.auth.id',
    viewRule: '@request.auth.id != "" && id = @request.auth.id',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    authRule: 'revoked = false',
    fields: [
      { name: 'device_name', type: 'text', required: true, max: 120 },
      { name: 'revoked', type: 'bool' },
      { name: 'revoked_at', type: 'date' },
      { name: 'last_seen_at', type: 'date' },
      { name: 'command_sequence', type: 'number', min: 0, noDecimal: true, default: 0 },
      { name: 'session_generation', type: 'number', min: 0, noDecimal: true, default: 0 },
    ],
    indexes: ['CREATE INDEX idx_controller_devices_active ON controller_devices (revoked)'],
  })
  app.save(devices)

  const grants = new Collection({
    name: 'controller_enrollment_grants',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'grant_hash', type: 'text', required: true, min: 64, max: 64 },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'used_at', type: 'date' },
      { name: 'created_by', type: 'text', max: 120 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_controller_grants_hash ON controller_enrollment_grants (grant_hash)'],
  })
  app.save(grants)

  const sessions = new Collection({
    name: 'controller_sessions',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'device', type: 'relation', collectionId: devices.id, required: true, maxSelect: 1 },
      { name: 'generation', type: 'number', required: true, min: 1, noDecimal: true },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'resumed_from', type: 'text', max: 15 },
      { name: 'revoked_at', type: 'date' },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_controller_session_generation ON controller_sessions (device, generation)',
      'CREATE INDEX idx_controller_session_device_expiry ON controller_sessions (device, expires_at)',
    ],
  })
  app.save(sessions)

  const commands = new Collection({
    name: 'controller_commands',
    type: 'base',
    listRule: '@request.auth.id != "" && @request.auth.collectionName = "controller_devices" && device = @request.auth.id',
    viewRule: '@request.auth.id != "" && @request.auth.collectionName = "controller_devices" && device = @request.auth.id',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'device', type: 'relation', collectionId: devices.id, required: true, maxSelect: 1 },
      { name: 'session_generation', type: 'number', required: true, min: 1, noDecimal: true },
      { name: 'sequence', type: 'number', required: true, min: 1, noDecimal: true },
      { name: 'idempotency_key', type: 'text', required: true, min: 8, max: 128 },
      { name: 'action', type: 'select', required: true, maxSelect: 1, values: ['open_video', 'play', 'pause', 'seek', 'get_now_playing'] },
      { name: 'payload', type: 'json', required: true, maxSize: 4096 },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'succeeded', 'failed'] },
      { name: 'error_code', type: 'text', max: 120 },
      { name: 'acked_at', type: 'date' },
      { name: 'issued_by', type: 'relation', collectionId: users.id, maxSelect: 1 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_controller_command_idempotency ON controller_commands (device, idempotency_key)',
      'CREATE UNIQUE INDEX idx_controller_command_sequence ON controller_commands (device, sequence)',
      'CREATE INDEX idx_controller_command_pending ON controller_commands (device, status, sequence)',
    ],
  })
  app.save(commands)

  const state = new Collection({
    name: 'controller_state',
    type: 'base',
    listRule: '@request.auth.id != "" && @request.auth.collectionName = "controller_devices" && device = @request.auth.id',
    viewRule: '@request.auth.id != "" && @request.auth.collectionName = "controller_devices" && device = @request.auth.id',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'device', type: 'relation', collectionId: devices.id, required: true, maxSelect: 1 },
      { name: 'session_generation', type: 'number', required: true, min: 1, noDecimal: true },
      { name: 'connection_state', type: 'select', required: true, maxSelect: 1, values: ['connected', 'connecting', 'disconnected', 'error'] },
      { name: 'video_id', type: 'text', max: 64 },
      { name: 'player_state', type: 'select', maxSelect: 1, values: ['playing', 'paused', 'buffering', 'ended', 'unstarted', 'unknown'] },
      { name: 'position_seconds', type: 'number', min: 0 },
      { name: 'duration_seconds', type: 'number', min: 0 },
      { name: 'last_command_sequence', type: 'number', min: 0, noDecimal: true },
      { name: 'observed_at', type: 'date', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_controller_state_device ON controller_state (device)'],
  })
  app.save(state)
}, (app) => {
  for (const name of ['controller_state', 'controller_commands', 'controller_sessions', 'controller_enrollment_grants', 'controller_devices']) {
    const collection = app.findCollectionByNameOrId(name)
    if (collection) app.delete(collection)
  }
})
