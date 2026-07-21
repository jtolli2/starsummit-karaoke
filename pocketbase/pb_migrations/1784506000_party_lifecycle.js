// Party lifecycle and queue schema for PocketBase 0.39.x.
// Public clients never receive direct write access; pb_hooks/party_queue.pb.js owns mutations.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const parties = new Collection({
    name: 'karaoke_parties', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'code_hash', type: 'text', required: true, min: 64, max: 64 },
      { name: 'code_hint', type: 'text', required: true, min: 4, max: 16 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'expired', 'closed'] },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1 },
      { name: 'controller_device', type: 'relation', collectionId: app.findCollectionByNameOrId('controller_devices').id, maxSelect: 1 },
      { name: 'last_join_at', type: 'date' },
      { name: 'join_count', type: 'number', min: 0, noDecimal: true, default: 0 },
      { name: 'queue_sequence', type: 'number', min: 0, noDecimal: true, default: 0 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_karaoke_parties_code_hash ON karaoke_parties (code_hash)', 'CREATE INDEX idx_karaoke_parties_expiry ON karaoke_parties (status, expires_at)'],
  })
  app.save(parties)

  const guests = new Collection({
    name: 'karaoke_guest_identities', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'party', type: 'relation', collectionId: parties.id, required: true, maxSelect: 1 },
      { name: 'credential_hash', type: 'text', required: true, min: 64, max: 64 },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'last_request_at', type: 'date' },
      { name: 'request_count', type: 'number', min: 0, noDecimal: true, default: 0 },
      { name: 'last_served_at', type: 'date' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_karaoke_guest_credential ON karaoke_guest_identities (credential_hash)', 'CREATE INDEX idx_karaoke_guest_party ON karaoke_guest_identities (party)'],
  })
  app.save(guests)

  const songs = new Collection({
    name: 'karaoke_songs', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'youtube_id', type: 'text', required: true, min: 11, max: 11 },
      { name: 'title', type: 'text', required: true, max: 240 },
      { name: 'artist', type: 'text', max: 160 },
      { name: 'eligible', type: 'bool', required: true, default: false },
      { name: 'provenance', type: 'text', max: 120 },
      { name: 'eligibility_reason', type: 'text', max: 240 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_karaoke_songs_youtube ON karaoke_songs (youtube_id)'],
  })
  app.save(songs)

  const queue = new Collection({
    name: 'karaoke_queue', type: 'base',
    listRule: null, viewRule: null,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'party', type: 'relation', collectionId: parties.id, required: true, maxSelect: 1 },
      { name: 'song', type: 'relation', collectionId: songs.id, required: true, maxSelect: 1 },
      { name: 'requester', type: 'relation', collectionId: guests.id, required: true, maxSelect: 1 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['queued', 'playing', 'completed', 'failed'] },
      { name: 'sequence', type: 'number', required: true, min: 1, noDecimal: true },
      { name: 'requested_at', type: 'date', required: true },
      { name: 'started_at', type: 'date' },
      { name: 'completed_at', type: 'date' },
      { name: 'failure_reason', type: 'text', max: 160 },
      { name: 'active_song_key', type: 'text', max: 64 },
    ],
    indexes: [
      'CREATE INDEX idx_karaoke_queue_active_song ON karaoke_queue (party, song, status)',
      'CREATE UNIQUE INDEX idx_karaoke_queue_active_song_key ON karaoke_queue (party, active_song_key)',
      'CREATE UNIQUE INDEX idx_karaoke_queue_sequence ON karaoke_queue (party, sequence)',
      'CREATE INDEX idx_karaoke_queue_pending ON karaoke_queue (party, status, sequence)',
    ],
  })
  app.save(queue)

  const joins = new Collection({
    name: 'karaoke_join_attempts', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'party', type: 'relation', collectionId: parties.id, required: true, maxSelect: 1 },
      { name: 'ip_hash', type: 'text', required: true, min: 64, max: 64 },
      { name: 'window_started_at', type: 'date', required: true },
      { name: 'attempts', type: 'number', required: true, min: 0, noDecimal: true, default: 0 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_karaoke_join_attempts_party_ip ON karaoke_join_attempts (party, ip_hash)',
      'CREATE INDEX idx_karaoke_join_attempts_window ON karaoke_join_attempts (window_started_at)',
    ],
  })
  app.save(joins)
}, (app) => {
  for (const name of ['karaoke_join_attempts', 'karaoke_queue', 'karaoke_songs', 'karaoke_guest_identities', 'karaoke_parties']) {
    const collection = app.findCollectionByNameOrId(name)
    if (collection) app.delete(collection)
  }
})
