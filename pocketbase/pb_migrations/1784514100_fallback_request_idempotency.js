migrate((app) => {
  let queue = null
  try { queue = app.findCollectionByNameOrId('karaoke_queue') } catch (_) {}
  if (!queue) return
  try { if (!queue.fields.getByName('request_key')) queue.fields.add(new Field({ name: 'request_key', type: 'text', max: 96 })) } catch (_) {}
  const index = 'CREATE UNIQUE INDEX idx_karaoke_queue_request_key ON karaoke_queue (party, requester, request_key)'
  if (!Array.isArray(queue.indexes) || !queue.indexes.some((value) => String(value).replace(/\s+/g, ' ').trim() === index)) queue.indexes.push(index)
  app.save(queue)
}, () => {})
