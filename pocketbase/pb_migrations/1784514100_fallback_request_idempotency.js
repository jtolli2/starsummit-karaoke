migrate((app) => {
  let queue = null
  try { queue = app.findCollectionByNameOrId('karaoke_queue') } catch (_) {}
  if (!queue) return
  try { if (!queue.fields.getByName('request_key')) queue.fields.add(new Field({ name: 'request_key', type: 'text', max: 96 })) } catch (_) {}
  // Retained queue rows may predate idempotency and have an empty request key.
  // Exclude those legacy values so the unique index can be applied in place.
  const index = 'CREATE UNIQUE INDEX idx_karaoke_queue_request_key ON karaoke_queue (party, requester, request_key) WHERE request_key IS NOT NULL AND request_key != \'\''
  if (!Array.isArray(queue.indexes) || !queue.indexes.some((value) => String(value).replace(/\s+/g, ' ').trim() === index)) queue.indexes.push(index)
  app.save(queue)
}, () => {})
