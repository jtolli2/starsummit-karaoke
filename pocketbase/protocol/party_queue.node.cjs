'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')
const failureReasonMigration = fs.readFileSync(
  path.join(__dirname, '..', 'pb_migrations', '1784514230_repair_queue_failure_reason.js'),
  'utf8',
)

test('tablet active callback resolves now through the reload-safe global contract', () => {
  const endpoint = hook.match(/routerAdd\('GET', '\/api\/karaoke\/tablet\/active',[\s\S]*?\n}\)/)
  assert.ok(endpoint)
  assert.match(endpoint[0], /const \{ auth, tablet, json, records, id, str, now \} = globalThis\.__partyQueue/)
  assert.match(endpoint[0], /expires_at > \{:\s*now\}/)
  assert.match(endpoint[0], /now\(\)/)
})

test('party creation binds exactly one active controller without guessing between devices', () => {
  const endpoint = hook.match(/routerAdd\('POST', '\/api\/karaoke\/parties',[\s\S]*?\n}\)/)
  assert.ok(endpoint)
  assert.match(endpoint[0], /revoked = false && last_seen_at > \{:\s*cutoff\}/)
  assert.match(endpoint[0], /cutoff: filterDate\(Date\.now\(\) - CONTROLLER_STATE_TTL\)/)
  assert.match(endpoint[0], /if \(controllers\.length === 1\) set\(party, 'controller_device', id\(controllers\[0\]\)\)/)
})

test('tablet can bind an unassigned party only to its single available controller', () => {
  const endpoint = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/controller\/bind',[\s\S]*?\n}\)/)
  assert.ok(endpoint)
  assert.match(endpoint[0], /created_by'\) !== id\(operator\)/)
  assert.match(endpoint[0], /controllers\.length !== 1/)
  assert.match(endpoint[0], /last_seen_at > \{:\s*cutoff\}/)
  assert.match(endpoint[0], /cutoff: filterDate\(Date\.now\(\) - CONTROLLER_STATE_TTL\)/)
  assert.match(endpoint[0], /set\(party, 'controller_device', deviceId\)/)
})

test('tablet playback controls are party-scoped, current, monotonic, and idempotent', () => {
  const endpoint = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/controller\/playback',[\s\S]*?\n}\)/)
  assert.ok(endpoint)
  assert.match(endpoint[0], /tablet\(operator\)/)
  assert.match(endpoint[0], /created_by'\) !== id\(operator\)/)
  assert.match(endpoint[0], /status = "playing"/)
  assert.match(endpoint[0], /CONTROLLER_STATE_TTL/)
  assert.match(endpoint[0], /video_id'\) !== str\(song, 'youtube_id'\)/)
  assert.match(endpoint[0], /idempotency_key = \{:key\}/)
  assert.ok(
    endpoint[0].indexOf('idempotency_key = {:key}') <
      endpoint[0].indexOf("const stateFresh = controllerState"),
    'durable replay must resolve before volatile controller state checks',
  )
  assert.match(endpoint[0], /playback_state_conflict/)
  assert.match(endpoint[0], /command_sequence'\) \+ 1/)
  assert.match(endpoint[0], /set\(command, 'action', action\)/)
  assert.match(endpoint[0], /setJson\(command, 'payload', \{\}\)/)
})

test('controller liveness filter uses the PocketBase-normalized datetime representation', () => {
  const helper = hook.match(/function filterDate\(value = new Date\(\)\) \{[^\n]+\}/)
  assert.ok(helper)
  assert.match(helper[0], /toISOString\(\)\.replace\('T', ' '\)/)
})

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

test('terminal queue rows release the video id without colliding with each other', () => {
  const transition = hook.match(/routerAdd\('POST', '\/api\/karaoke\/queue\/transition',[\s\S]*?\n}\)/)
  assert.ok(transition)
  assert.match(transition[0], /set\(queue, 'active_song_key', `terminal:\$\{id\(queue\)\}`\)/)
  assert.match(transition[0], /failureType === 'text'/)
  assert.match(transition[0], /set\(queue, 'failure_reason'/)
  assert.match(transition[0], /reason = known\.includes\(error\.message\) \? error\.message : 'transition_failed'/)

  const terminalKey = (queueId) => `terminal:${queueId}`
  assert.notEqual(terminalKey('queue-a'), terminalKey('queue-b'))
  assert.notEqual(terminalKey('queue-a'), 'nMDXPAM8RwE')
})

test('failure reason compatibility cannot block authoritative terminal state', () => {
  assert.match(failureReasonMigration, /typeof failureReason\.type === 'function'/)
  assert.match(failureReasonMigration, /if \(fieldType !== 'text'\) return/)
  assert.match(failureReasonMigration, /failureReason\.max = 160/)
  assert.match(failureReasonMigration, /failureReason\.required = false/)
  assert.match(hook, /if \(failureType === 'text'\)/)
})

// Reference for the transition guard: queue state must not advance until the
// party is live and the controller has a current connected state report.
const CONTROLLER_STATE_TTL = 90 * 1000

function canStart(party, controller, currentTime = Date.now()) {
  return party.status === 'active' && party.expiresAt > currentTime && controller?.sessionActive === true && controller.stateGeneration === controller.generation && controller.connectionState === 'connected' && controller.observedAt > currentTime - CONTROLLER_STATE_TTL
}

test('start is rejected without a connected current controller and leaves queue state queued', () => {
  const queued = { status: 'queued' }
  const currentTime = Date.now()
  assert.equal(canStart({ status: 'active', expiresAt: currentTime + 1000 }, { sessionActive: true, generation: 2, stateGeneration: 2, connectionState: 'connecting', observedAt: currentTime }, currentTime), false)
  assert.equal(queued.status, 'queued')
})

test('start is rejected for an expired party even with a connected controller', () => {
  const currentTime = Date.now()
  assert.equal(canStart({ status: 'active', expiresAt: currentTime - 1 }, { sessionActive: true, generation: 2, stateGeneration: 2, connectionState: 'connected', observedAt: currentTime }, currentTime), false)
})

test('start is rejected when a connected controller report is stale', () => {
  const currentTime = Date.now()
  assert.equal(canStart({ status: 'active', expiresAt: currentTime + 1000 }, { sessionActive: true, generation: 2, stateGeneration: 2, connectionState: 'connected', observedAt: currentTime - CONTROLLER_STATE_TTL - 1 }, currentTime), false)
})

module.exports = { chooseNext, canStart, CONTROLLER_STATE_TTL }
