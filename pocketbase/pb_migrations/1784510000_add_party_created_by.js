// Forward migration for installations that applied the party lifecycle before
// tablet active-party recovery began tracking its owning operator.
migrate((app) => {
  const parties = app.findCollectionByNameOrId('karaoke_parties')
  let createdBy
  try { createdBy = parties.fields.getByName('created_by') } catch (_) { createdBy = null }
  if (!createdBy) {
    const users = app.findCollectionByNameOrId('users')
    parties.fields.add(new Field({ name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1 }))
    app.save(parties)
  }
}, (app) => {
  const parties = app.findCollectionByNameOrId('karaoke_parties')
  let createdBy
  try { createdBy = parties.fields.getByName('created_by') } catch (_) { createdBy = null }
  if (createdBy) {
    parties.fields.removeByName('created_by')
    app.save(parties)
  }
})
