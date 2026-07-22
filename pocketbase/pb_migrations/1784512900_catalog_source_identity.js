// Preserve canonical source identity separately from YouTube uploader provenance.
migrate((app) => {
  const songs = app.findCollectionByNameOrId('karaoke_songs')
  const add = (name, type, options = {}) => {
    let existing = null
    try { existing = songs.fields.getByName(name) } catch (_) {}
    if (!existing) songs.fields.add(new Field({ name, type, ...options }))
  }
  add('source_id', 'text', { max: 160 })
  add('source_list', 'text', { max: 120 })
  add('source_popularity', 'number', { min: 0 })
  add('genres_json', 'json')
  add('release_year', 'number', { min: 0, max: 3000, noDecimal: true })
  add('video_title', 'text', { max: 500 })
  add('video_channel_title', 'text', { max: 240 })
  add('video_channel_id', 'text', { max: 120 })
  add('identity_status', 'select', {
    maxSelect: 1,
    values: ['verified_source', 'operator_corrected', 'missing', 'uncertain'],
    required: true,
    default: 'missing',
  })
  add('identity_reason', 'text', { max: 240 })
  app.save(songs)

  // Every pre-migration row lacks a source/operator identity attestation. Keep
  // its display metadata and audit history, but remove it from guest and
  // replacement eligibility until an operator corrects/reviews it.
  const retained = app.findRecordsByFilter('karaoke_songs', '', '+id', 100000, 0)
  for (const song of retained) {
    const history = song.get('review_history_json'); const events = Array.isArray(history) ? history : []
    events.push({ action: 'identity_quarantine', reason: 'legacy_identity_unverified', at: new Date().toISOString() })
    song.set('review_history_json', events); song.set('identity_status', 'missing')
    song.set('identity_reason', 'legacy_identity_unverified'); song.set('eligible', false)
    song.set('review_status', 'needs_review'); app.save(song)
  }
}, () => {
  // Forward-only: retained catalog provenance must not be removed on rollback.
})
