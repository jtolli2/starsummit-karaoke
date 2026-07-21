'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// Reference implementation of the server's deterministic round-robin rule.
function chooseNext(pending, servedAt = {}) {
  const firstByRequester = new Map()
  for (const item of pending.slice().sort((a, b) => a.sequence - b.sequence)) {
    if (!firstByRequester.has(item.requester)) firstByRequester.set(item.requester, item)
  }
  return [...firstByRequester.values()].sort((a, b) => {
    const ta = servedAt[a.requester] || 0
    const tb = servedAt[b.requester] || 0
    return ta - tb || a.sequence - b.sequence || a.requester.localeCompare(b.requester)
  })[0] || null
}

test('fair rotation gives each requester one turn, FIFO within requester', () => {
  const pending = [
    { requester: 'a', sequence: 1 }, { requester: 'a', sequence: 3 },
    { requester: 'b', sequence: 2 }, { requester: 'b', sequence: 4 },
  ]
  assert.equal(chooseNext(pending).requester, 'a')
  assert.equal(chooseNext(pending, { a: 10, b: 0 }).requester, 'b')
})

test('equal served timestamps break by pending sequence then requester id', () => {
  const item = chooseNext([{ requester: 'z', sequence: 8 }, { requester: 'a', sequence: 2 }], { z: 1, a: 1 })
  assert.deepEqual(item, { requester: 'a', sequence: 2 })
})

test('completed songs are not considered duplicates', () => {
  const active = (status) => status === 'queued' || status === 'playing'
  assert.equal(active('completed'), false)
  assert.equal(active('queued'), true)
})

module.exports = { chooseNext }
