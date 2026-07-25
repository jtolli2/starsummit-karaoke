migrate((app) => {
  let jobs = null
  try { jobs = app.findCollectionByNameOrId('karaoke_legacy_playlist_jobs') } catch (_) {}
  if (!jobs) return
  let field = null
  try { field = jobs.fields.getByName('policy_version') } catch (_) {}
  if (!field) {
    jobs.fields.add(new Field({ name: 'policy_version', type: 'text', max: 48 }))
    app.save(jobs)
  }
}, (app) => {})
