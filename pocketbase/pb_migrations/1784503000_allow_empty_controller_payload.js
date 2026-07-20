// Empty payloads are valid for play, pause, and get_now_playing.
// The hook validates every action payload before saving, so the database field need not be required.
migrate((app) => {
  const commands = app.findCollectionByNameOrId('controller_commands')
  const payload = commands.fields.getByName('payload')
  payload.required = false
  app.save(commands)
}, (app) => {
  const commands = app.findCollectionByNameOrId('controller_commands')
  const payload = commands.fields.getByName('payload')
  payload.required = true
  app.save(commands)
})
