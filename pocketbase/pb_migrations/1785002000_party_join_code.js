// Retain new party join codes so the owning operator can restore the guest link
// after a reload. Legacy hashes and existing party records remain untouched.
migrate(
  (app) => {
    const parties = app.findCollectionByNameOrId('karaoke_parties')
    if (!parties) return
    try {
      if (parties.fields.getByName('join_code')) return
    } catch (_) {}
    parties.fields.add(
      new Field({
        name: 'join_code',
        type: 'text',
        required: false,
        hidden: true,
        max: 8,
      }),
    )
    app.save(parties)
  },
  () => {},
)
