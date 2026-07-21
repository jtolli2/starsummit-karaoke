// PocketBase bool fields marked required reject an explicit false value.
// Eligibility is intentionally false for songs that have not been approved yet.
migrate((app) => {
  const songs = app.findCollectionByNameOrId('karaoke_songs')
  const eligible = songs.fields.getByName('eligible')
  eligible.required = false
  app.save(songs)
}, (app) => {
  const songs = app.findCollectionByNameOrId('karaoke_songs')
  const eligible = songs.fields.getByName('eligible')
  eligible.required = true
  app.save(songs)
})
