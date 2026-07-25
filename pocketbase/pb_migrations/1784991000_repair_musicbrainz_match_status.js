// Repair only blank/invalid retained MusicBrainz matcher status.  This is
// intentionally forward-only: matcher evidence, provenance, and audit history
// are retained exactly as stored.
migrate((app) => {
  let songs = null
  try { songs = app.findCollectionByNameOrId('karaoke_songs') } catch (_) {}
  if (!songs) return
  let field = null
  try { field = songs.fields.getByName('mb_match_status') } catch (_) {}
  if (!field) return

  const read = (record) => {
    try { return String(record.getString('mb_match_status') || '') } catch (_) {}
    try { return String(record.get('mb_match_status') || '') } catch (_) {}
    return ''
  }
  const valid = new Set(['not_attempted', 'matched', 'deferred'])
  // Do not rely on select validation here: retained imports can contain values
  // outside the current option set and must be quarantined deterministically.
  while (true) {
    const rows = app.findRecordsByFilter('karaoke_songs', 'mb_match_status = ""', '+id', 500, 0)
    const invalid = rows.filter((record) => !valid.has(read(record)))
    if (!invalid.length) break
    for (const record of invalid) { record.set('mb_match_status', 'not_attempted'); app.save(record) }
    if (rows.length < 500) break
  }
  // A malformed nonblank value may not be returned by the filter above on
  // runtimes that enforce select choices. Scan retained rows as a final guard.
  const retained = app.findRecordsByFilter('karaoke_songs', '', '+id', 100000, 0)
  for (const record of retained) if (!valid.has(read(record))) { record.set('mb_match_status', 'not_attempted'); app.save(record) }
}, () => {})
