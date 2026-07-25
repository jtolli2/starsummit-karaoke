// Durable, resumable MusicBrainz identity matching state. No release is used
// as canonical identity; releases are retained only as provenance evidence.
migrate((app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const songs = find('karaoke_songs')
  if (songs) {
    const add = (name, type, options = {}) => { let field = null; try { field = songs.fields.getByName(name) } catch (_) {} if (!field) songs.fields.add(new Field({ name, type, ...options })) }
    add('mb_recording_id', 'text', { max: 36 }); add('mb_match_status', 'select', { maxSelect: 1, values: ['not_attempted', 'matched', 'deferred'], required: true, default: 'not_attempted' }); add('mb_match_reason', 'text', { max: 120 }); add('mb_match_confidence', 'number', { min: 0, max: 1 }); add('mb_runner_up_json', 'json'); add('mb_provenance_json', 'json'); add('mb_matched_at', 'date'); app.save(songs)
  }
  if (!find('karaoke_musicbrainz_cache')) app.save(new Collection({ name: 'karaoke_musicbrainz_cache', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [{ name: 'cache_key', type: 'text', required: true, max: 240 }, { name: 'payload_json', type: 'json' }, { name: 'expires_at', type: 'date' }, { name: 'updated_at', type: 'date' }], indexes: ['CREATE UNIQUE INDEX idx_karaoke_mb_cache_key ON karaoke_musicbrainz_cache (cache_key)'] }))
  let jobs = find('karaoke_musicbrainz_matches')
  if (!jobs) jobs = new Collection({ name: 'karaoke_musicbrainz_matches', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [{ name: 'job_key', type: 'text', required: true, max: 100 }, { name: 'source_id', type: 'text', max: 240 }, { name: 'snapshot_fingerprint', type: 'text', max: 64 }, { name: 'input_digest', type: 'text', max: 64 }, { name: 'inputs_json', type: 'json' }, { name: 'policy_version', type: 'text', max: 40 }, { name: 'parser_version', type: 'text', max: 40 }, { name: 'cursor', type: 'number', min: 0, noDecimal: true, default: 0 }, { name: 'max_items', type: 'number', min: 0, noDecimal: true, default: 20 }, { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'running', 'complete', 'failed'], required: true, default: 'pending' }, { name: 'dry_run', type: 'bool', default: true }, { name: 'report_json', type: 'json' }, { name: 'last_error', type: 'text', max: 160 }, { name: 'expires_at', type: 'date' }, { name: 'updated_at', type: 'date' }], indexes: ['CREATE UNIQUE INDEX idx_karaoke_mb_match_job ON karaoke_musicbrainz_matches (job_key)'] })
  else {
    let changed = false
    const add = (name, type, options = {}) => { let field = null; try { field = jobs.fields.getByName(name) } catch (_) {} if (field) return; jobs.fields.add(new Field({ name, type, ...options })); changed = true }
    add('source_id', 'text', { max: 240 }); add('snapshot_fingerprint', 'text', { max: 64 }); add('input_digest', 'text', { max: 64 }); add('inputs_json', 'json'); add('policy_version', 'text', { max: 40 }); add('parser_version', 'text', { max: 40 }); add('max_items', 'number', { min: 0, noDecimal: true, default: 20 }); add('expires_at', 'date'); add('updated_at', 'date'); if (changed) app.save(jobs)
  }
}, (app) => {
  const find = (name) => { try { return app.findCollectionByNameOrId(name) } catch (_) { return null } }
  const songs = find('karaoke_songs')
  if (songs) { for (const name of ['mb_recording_id', 'mb_match_status', 'mb_match_reason', 'mb_match_confidence', 'mb_runner_up_json', 'mb_provenance_json', 'mb_matched_at']) { try { const field = songs.fields.getByName(name); if (field) songs.fields.remove(field) } catch (_) {} } try { app.save(songs) } catch (_) {} }
  const jobs = find('karaoke_musicbrainz_matches'); if (jobs) app.delete(jobs)
  const cache = find('karaoke_musicbrainz_cache'); if (cache) app.delete(cache)
})
