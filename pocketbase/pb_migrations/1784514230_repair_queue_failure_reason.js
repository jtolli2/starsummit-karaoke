// Retained staging can predate the failure-reason field even when its queue
// status enum already accepts `failed`. Add only the missing optional field;
// queue records and their existing transition history are left untouched.
migrate((app) => {
  let queue = null
  try { queue = app.findCollectionByNameOrId('karaoke_queue') } catch (_) {}
  if (!queue) return

  let failureReason = null
  try { failureReason = queue.fields.getByName('failure_reason') } catch (_) {}
  if (failureReason) return

  queue.fields.add(new Field({ name: 'failure_reason', type: 'text', max: 160 }))
  app.save(queue)
}, () => {})
