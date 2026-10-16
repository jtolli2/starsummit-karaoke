// Retain tablet recovery request aliases without replacing a command's canonical idempotency key.
migrate((app) => {
  let commands = null
  try { commands = app.findCollectionByNameOrId('controller_commands') } catch (_) {}
  if (!commands) return

  let field = null
  try { field = commands.fields.getByName('recovery_keys') } catch (_) {}
  if (field) return

  commands.fields.add(new Field({ name: 'recovery_keys', type: 'json', required: false, maxSize: 8192, hidden: true }))
  app.save(commands)
}, () => {})
