'use strict'

// Behavioral queue-reorder coverage on the pinned PocketBase runtime:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/tablet_reorder.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

test('tablet reorder authorization, target placement, and playback lifecycle', { skip: !process.env.POCKETBASE_BIN }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-tablet-reorder-pb-'))
  fs.cpSync(path.join(__dirname, '..', 'pb_migrations'), path.join(root, 'pb_migrations'), { recursive: true })
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data')
  const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'ignore' })
  execFileSync(bin, ['superuser', 'upsert', 'reorder@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir], { stdio: 'ignore' })
  const port = 20000 + Math.floor(Math.random() * 10000)
  const server = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' })
  t.after(() => server.kill('SIGTERM'))
  const base = `http://127.0.0.1:${port}`
  let healthy = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(healthy, true, 'PocketBase should become ready')

  const call = async (url, method, body, token) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = {}
    try { json = await response.json() } catch (_) {}
    return { status: response.status, json }
  }
  const superAuth = await call('/api/collections/_superusers/auth-with-password', 'POST', {
    identity: 'reorder@test.invalid', password: 'CorrectHorseBatteryStaple123!',
  })
  assert.equal(superAuth.status, 200)
  const superToken = superAuth.json.token
  const makeTablet = async (email) => {
    const record = await call('/api/collections/users/records', 'POST', {
      email, password: 'TabletPassword123!', passwordConfirm: 'TabletPassword123!', role: 'tablet_admin',
    }, superToken)
    assert.equal(record.status, 200, JSON.stringify(record))
    const auth = await call('/api/collections/users/auth-with-password', 'POST', {
      identity: email, password: 'TabletPassword123!',
    })
    assert.equal(auth.status, 200, JSON.stringify(auth))
    return auth.json.token
  }
  const tabletToken = await makeTablet('tablet-reorder@test.invalid')
  const otherTabletToken = await makeTablet('other-reorder@test.invalid')
  const inactive = await call('/api/karaoke/parties', 'POST', {}, tabletToken)
  assert.equal(inactive.status, 201, JSON.stringify(inactive))
  const party = await call('/api/karaoke/parties', 'POST', {}, tabletToken)
  assert.equal(party.status, 201, JSON.stringify(party))
  assert.equal((await call(`/api/collections/karaoke_parties/records/${inactive.json.id}`, 'PATCH', {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }, superToken)).status, 200)

  const active = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.equal(active.status, 200, JSON.stringify(active))
  assert.ok(Number.isInteger(active.json.queueOrderRevision))
  assert.equal(typeof active.json.queueOrderDigest, 'string')
  const songs = await Promise.all(['dQw4w9WgXcQ', '9bZkp7q19f0', 'J---aiyznGQ', 'Zi_XLOBDo_Y', 'M7lc1UVf-VE', 'QH2-TGUlwu4'].map((youtube_id, index) =>
    call('/api/collections/karaoke_songs/records', 'POST', {
      youtube_id, title: `Reorder fixture ${index}`, artist: 'Test', eligible: true,
      classification: 'karaoke', review_status: 'approved', identity_status: 'verified_source',
      mb_match_status: 'not_attempted',
    }, superToken),
  ))
  songs.forEach((song) => assert.equal(song.status, 200, JSON.stringify(song)))
  const guests = await Promise.all(songs.map(() => call('/api/karaoke/parties/join', 'POST', { code: party.json.code })))
  guests.forEach((guest) => assert.equal(guest.status, 201, JSON.stringify(guest)))

  const grant = await call('/api/karaoke/controllers/enrollment-grants', 'POST', { ttlMinutes: 5 }, tabletToken)
  assert.equal(grant.status, 201, JSON.stringify(grant))
  const enrolled = await call('/api/karaoke/controllers/enroll', 'POST', { token: grant.json.token, deviceName: 'reorder fixture tablet' })
  assert.equal(enrolled.status, 201, JSON.stringify(enrolled))
  assert.equal((await call(`/api/collections/karaoke_parties/records/${party.json.id}`, 'PATCH', { controller_device: enrolled.json.deviceId }, superToken)).status, 200)
  const deviceAuth = await call('/api/collections/controller_devices/auth-with-password', 'POST', {
    identity: enrolled.json.deviceKey, password: enrolled.json.deviceSecret,
  })
  assert.equal(deviceAuth.status, 200, JSON.stringify(deviceAuth))
  const deviceToken = deviceAuth.json.token
  const session = await call('/api/karaoke/controllers/sessions', 'POST', {}, deviceToken)
  assert.equal(session.status, 201, JSON.stringify(session))

  const submit = async (index) => call('/api/karaoke/requests', 'POST', {
    credential: guests[index].json.credential, youtubeId: songs[index].json.youtube_id,
  })
  const initialRequests = await Promise.all([0, 1, 2].map(submit))
  initialRequests.forEach((request) => assert.equal(request.status, 201, JSON.stringify(request)))
  const firstSnapshot = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.equal(firstSnapshot.status, 200)
  const initialQueue = firstSnapshot.json.queue.map((item) => item.id)
  const queued = firstSnapshot.json.queue.filter((item) => item.status === 'queued')
  assert.equal(queued.length, 3)

  const requestBody = (snapshot, movedId, selector) => ({
    partyId: party.json.id, queueId: movedId, ...selector,
    expectedRevision: snapshot.json.queueOrderRevision, expectedDigest: snapshot.json.queueOrderDigest,
  })
  const forbidden = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(firstSnapshot, queued[1].id, { direction: 'up' }))
  assert.ok([401, 403].includes(forbidden.status), JSON.stringify(forbidden))
  const otherOwner = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(firstSnapshot, queued[1].id, { direction: 'up' }), otherTabletToken)
  assert.ok([403, 404].includes(otherOwner.status), JSON.stringify(otherOwner))
  const nonActiveParty = await call('/api/karaoke/tablet/queue/reorder', 'POST', {
    ...requestBody(firstSnapshot, queued[1].id, { direction: 'up' }), partyId: inactive.json.id,
  }, tabletToken)
  assert.equal(nonActiveParty.status, 410, JSON.stringify(nonActiveParty))
  assert.equal(nonActiveParty.json.error, 'party_expired')

  const malformedSelectors = [
    { direction: 'up', targetQueueId: queued[0].id },
    { direction: 'up', targetQueueId: '' },
    { targetQueueId: '' },
    { targetQueueId: 17 },
    {},
  ]
  for (const selector of malformedSelectors) {
    const invalid = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(firstSnapshot, queued[1].id, selector), tabletToken)
    assert.equal(invalid.status, 422, JSON.stringify({ selector, invalid }))
  }

  const lateGuestRequest = await submit(3)
  assert.equal(lateGuestRequest.status, 201, JSON.stringify(lateGuestRequest))
  const staleRevision = await call('/api/karaoke/tablet/queue/reorder', 'POST', {
    ...requestBody(firstSnapshot, queued[1].id, { direction: 'up' }),
    expectedRevision: firstSnapshot.json.queueOrderRevision,
    expectedDigest: (await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)).json.queueOrderDigest,
  }, tabletToken)
  assert.equal(staleRevision.status, 409, JSON.stringify(staleRevision))
  assert.equal(staleRevision.json.error, 'stale_reorder')
  const currentAfterGuest = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  const staleDigest = await call('/api/karaoke/tablet/queue/reorder', 'POST', {
    ...requestBody(currentAfterGuest, queued[1].id, { direction: 'up' }),
    expectedDigest: firstSnapshot.json.queueOrderDigest,
  }, tabletToken)
  assert.equal(staleDigest.status, 409, JSON.stringify(staleDigest))
  assert.equal(staleDigest.json.error, 'stale_reorder')
  const recovered = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.ok(recovered.json.queue.some((item) => item.id === lateGuestRequest.json.id))
  assert.deepEqual(recovered.json.queue.slice(0, initialQueue.length).map((item) => item.id), initialQueue)

  const recoveredQueued = recovered.json.queue.filter((item) => item.status === 'queued')
  const beforePlayback = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(recovered, recoveredQueued[0].id, {
    targetQueueId: recoveredQueued[recoveredQueued.length - 1].id,
  }), tabletToken)
  assert.equal(beforePlayback.status, 200, JSON.stringify(beforePlayback))
  let status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.ok(status.json.queue.some((item) => item.id === lateGuestRequest.json.id))
  assert.deepEqual(status.json.queue.filter((item) => item.status === 'queued').map((item) => item.id), [
    recoveredQueued[1].id, recoveredQueued[2].id, recoveredQueued[3].id, recoveredQueued[0].id,
  ])
  const assertUniqueSequences = (queue) => {
    const values = queue.map((item) => item.sequence)
    assert.equal(new Set(values).size, values.length, `sequence slots should be unique: ${values}`)
  }
  assertUniqueSequences(status.json.queue)

  const preCompletionSnapshot = status
  const fifthGuestRequest = await submit(4)
  assert.equal(fifthGuestRequest.status, 201, JSON.stringify(fifthGuestRequest))
  const staleTarget = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(preCompletionSnapshot,
    recoveredQueued[1].id, { targetQueueId: recoveredQueued[0].id }), tabletToken)
  assert.equal(staleTarget.status, 409, JSON.stringify(staleTarget))
  assert.equal(staleTarget.json.error, 'stale_reorder')
  const freshTargetSnapshot = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  const freshQueued = freshTargetSnapshot.json.queue.filter((item) => item.status === 'queued')
  const freshTargetMove = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(freshTargetSnapshot,
    freshQueued[0].id, { targetQueueId: freshQueued.at(-1).id }), tabletToken)
  assert.equal(freshTargetMove.status, 200, JSON.stringify(freshTargetMove))
  status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.deepEqual(status.json.queue.filter((item) => item.status === 'queued').map((item) => item.id), [
    freshQueued[1].id, freshQueued[2].id, freshQueued[3].id, freshQueued[4].id, freshQueued[0].id,
  ])

  const playingBefore = await call(`/api/karaoke/queue/next?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.equal(playingBefore.status, 200, JSON.stringify(playingBefore))
  assert.equal(playingBefore.json.queue.id, status.json.queue.find((item) => item.status === 'queued').id)
  const connection = await call('/api/karaoke/controllers/state', 'PUT', {
    sessionId: session.json.id, generation: session.json.generation, connectionState: 'connected',
    videoId: playingBefore.json.queue.song.youtubeId, playerState: 'playing', positionSeconds: 1,
    durationSeconds: 120, lastCommandSequence: 1,
  }, deviceToken)
  assert.equal(connection.status, 200, JSON.stringify(connection))
  const started = await call('/api/karaoke/queue/transition', 'POST', {
    queueId: playingBefore.json.queue.id, from: 'queued', to: 'playing',
  }, tabletToken)
  assert.equal(started.status, 200, JSON.stringify(started))

  status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  const playingRow = status.json.queue.find((item) => item.status === 'playing')
  const playingSequence = playingRow.sequence
  const queuedDuringPlayback = status.json.queue.filter((item) => item.status === 'queued')
  const playingTargetRejected = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(status,
    queuedDuringPlayback.at(-1).id, { targetQueueId: playingRow.id }), tabletToken)
  assert.ok(![200, 201].includes(playingTargetRejected.status), JSON.stringify(playingTargetRejected))
  const unchangedAfterPlayingTarget = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.deepEqual(unchangedAfterPlayingTarget.json.queue.map((item) => item.id), status.json.queue.map((item) => item.id))

  const movingDuringPlayback = queuedDuringPlayback.at(-1)
  const priorDuringPlaybackOrder = queuedDuringPlayback.map((item) => item.id)
  const [whilePlaying, sixthGuestRequest] = await Promise.all([
    call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(status, movingDuringPlayback.id, {
      targetQueueId: queuedDuringPlayback[0].id,
    }), tabletToken),
    submit(5),
  ])
  assert.equal(sixthGuestRequest.status, 201, JSON.stringify(sixthGuestRequest))
  assert.ok([200, 409].includes(whilePlaying.status), JSON.stringify(whilePlaying))
  if (whilePlaying.status === 409) assert.equal(whilePlaying.json.error, 'stale_reorder')
  status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.equal(status.json.queue.find((item) => item.status === 'playing').id, playingRow.id)
  assert.equal(status.json.queue.find((item) => item.status === 'playing').sequence, playingSequence)
  assert.ok(status.json.queue.some((item) => item.id === sixthGuestRequest.json.id))
  let expectedDuringPlaybackCore = whilePlaying.status === 200
    ? [movingDuringPlayback.id, ...priorDuringPlaybackOrder.slice(0, -1)]
    : priorDuringPlaybackOrder
  if (whilePlaying.status === 409) {
    const freshSnapshot = status
    const refreshedQueued = freshSnapshot.json.queue.filter((item) => item.status === 'queued')
    const recoveredTargetMove = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(freshSnapshot,
      movingDuringPlayback.id, { targetQueueId: refreshedQueued[0].id }), tabletToken)
    assert.equal(recoveredTargetMove.status, 200, JSON.stringify(recoveredTargetMove))
    expectedDuringPlaybackCore = [movingDuringPlayback.id, ...refreshedQueued
      .filter((item) => item.id !== movingDuringPlayback.id && item.id !== sixthGuestRequest.json.id)
      .map((item) => item.id)]
    status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  } else {
  }
  assert.deepEqual(status.json.queue.filter((item) => item.status === 'queued')
    .filter((item) => item.id !== sixthGuestRequest.json.id)
    .map((item) => item.id), expectedDuringPlaybackCore)
  assertUniqueSequences(status.json.queue)

  const completed = await call('/api/karaoke/queue/transition', 'POST', {
    queueId: playingRow.id, from: 'playing', to: 'completed',
  }, tabletToken)
  assert.equal(completed.status, 200, JSON.stringify(completed))
  const terminalSequence = (await call(`/api/collections/karaoke_queue/records/${playingRow.id}`, 'GET', undefined, superToken)).json.sequence
  status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  const queuedAfterCompletion = status.json.queue.filter((item) => item.status === 'queued')
  const expectedAfterCompletion = [
    ...queuedAfterCompletion.slice(1).map((item) => item.id), queuedAfterCompletion[0].id,
  ]
  const afterCompletion = await call('/api/karaoke/tablet/queue/reorder', 'POST', requestBody(status, queuedAfterCompletion[0].id, {
    targetQueueId: queuedAfterCompletion.at(-1).id,
  }), tabletToken)
  assert.equal(afterCompletion.status, 200, JSON.stringify(afterCompletion))
  status = await call(`/api/karaoke/tablet/status?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  const terminalRow = await call(`/api/collections/karaoke_queue/records/${playingRow.id}`, 'GET', undefined, superToken)
  assert.equal(terminalRow.status, 200, JSON.stringify(terminalRow))
  assert.equal(terminalRow.json.status, 'completed')
  assert.equal(terminalRow.json.sequence, terminalSequence)
  assert.deepEqual(status.json.queue.filter((item) => item.status === 'queued').map((item) => item.id), expectedAfterCompletion)
  assertUniqueSequences(status.json.queue)
  const authoritativeNext = await call(`/api/karaoke/queue/next?partyId=${party.json.id}`, 'GET', undefined, tabletToken)
  assert.equal(authoritativeNext.status, 200, JSON.stringify(authoritativeNext))
  assert.equal(authoritativeNext.json.queue.id, expectedAfterCompletion[0])
  assert.ok(status.json.queue.some((item) => item.id === lateGuestRequest.json.id))
})
