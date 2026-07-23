// Retained staging can predate the failure-reason field even when its queue
// status enum already accepts `failed`. Add the missing optional field or
// normalize safe text-field options; records and transition history stay intact.
migrate((app) => {
  let queue = null
  try { queue = app.findCollectionByNameOrId('karaoke_queue') } catch (_) {}
  if (!queue) return

  let failureReason = null
  try { failureReason = queue.fields.getByName('failure_reason') } catch (_) {}
  if (!failureReason) {
    queue.fields.add(new Field({ name: 'failure_reason', type: 'text', max: 160 }))
    app.save(queue)
    return
  }

  let fieldType = ''
  try { fieldType = typeof failureReason.type === 'function' ? String(failureReason.type()) : String(failureReason.type || '') } catch (_) {}
  if (fieldType !== 'text') return

  let changed = false
  if (Number(failureReason.max || 0) < 160) { failureReason.max = 160; changed = true }
  if (failureReason.required === true) { failureReason.required = false; changed = true }
  if (changed) app.save(queue)
}, () => {})
