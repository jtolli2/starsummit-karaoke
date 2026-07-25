'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const hook = fs.readFileSync(
  path.join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'),
  'utf8',
)
const route =
  hook.match(
    /routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/legacy-playlist\/approve-matched',[\s\S]*?\n}\)/,
  )?.[0] || ''

test('completed matcher approval is constrained to tablet admin and immutable job evidence', () => {
  assert.match(route, /if \(!q\.tablet\(actor\)\)/)
  assert.match(route, /findRecordById\('karaoke_legacy_playlist_jobs', jobId\)/)
  assert.match(route, /q\.str\(job, 'status'\) !== 'complete'/)
  assert.match(route, /q\.num\(job, 'cursor'\) < rows\.length/)
  assert.match(route, /q\.str\(job, 'playlist_id'\) !== q\.legacyPlaylistId/)
  assert.match(route, /q\.str\(job, 'policy_version'\) !== q\.legacyPolicyVersion/)
  assert.match(route, /q\.hash\(q\.serializeJson\(row\)\)/)
  assert.match(route, /binding_input_digest/)
  assert.match(route, /binding_row_digest/)
  assert.match(route, /mb_match_status/)
})

test('completed matcher approval uses shared policy and durable bounded idempotency', () => {
  assert.match(route, /q\.catalogApprovalReason\(song, store\)/)
  assert.match(route, /karaoke_catalog_approval_operations/)
  assert.match(route, /operation_binding_mismatch/)
  assert.match(route, /candidates\.slice\(cursor, cursor \+ 20\)/)
  assert.match(route, /action: 'completed_matcher_approval'/)
  assert.match(route, /review_status', 'approved'/)
  assert.match(route, /eligible', true/)
  assert.match(route, /status', 'complete'/)
  assert.doesNotMatch(route, /findRecordsByFilter\('karaoke_songs', ''/)
})
