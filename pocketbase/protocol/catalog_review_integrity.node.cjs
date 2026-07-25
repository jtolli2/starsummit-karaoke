'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1784991000_repair_musicbrainz_match_status.js'), 'utf8')

test('retained matcher status repair is forward-only, bounded, and idempotent', () => {
  assert.match(migration, /mb_match_status/)
  assert.match(migration, /not_attempted/)
  assert.match(migration, /new Set\(\['not_attempted', 'matched', 'deferred'\]\)/)
  assert.match(migration, /record\.set\('mb_match_status', 'not_attempted'\)/)
  assert.match(migration, /}, \(\) => \{\}\)/)
  assert.doesNotMatch(migration, /app\.delete|fields\.remove/)
})

test('individual and bulk approval share the authoritative policy and normalized errors', () => {
  assert.match(hook, /function catalogApprovalReason\(song, store\)/)
  assert.match(hook, /catalogApprovalReason\(song, tx\)/)
  assert.match(hook, /const predicate = \(song\) => !parser\.catalogApprovalReason\(song, \$app\)/)
  assert.match(hook, /identity_conflict/)
  assert.match(hook, /missing_identity/)
  assert.match(hook, /non_karaoke/)
  assert.match(hook, /schema_invalid/)
  assert.match(hook, /reviewState === 'approved'/)
  assert.match(hook, /const wasApproved = review === 'approved'/)
  assert.match(hook, /if \(wasApproved\) return 'already_approved'/)
  const commit = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/review\/selection\/commit',[\s\S]*?\n}\)/)?.[0] || ''
  assert.match(commit, /catalogApprovalReason\(song, tx\) === null/)
  assert.doesNotMatch(commit, /parser\.isApprovable\(/)
})

test('review demotion records audit and clears eligibility transactionally', () => {
  const route = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/\{id\}\/review',[\s\S]*?\n}\)/)?.[0] || ''
  assert.match(route, /\$app\.runInTransaction\(\(tx\)/)
  assert.match(route, /action: 'review'/)
  assert.match(route, /set\(song, 'eligible', reviewState === 'approved'\)/)
  assert.match(route, /schema_invalid/)
})

test('catalog list exposes only sanitized server approval diagnostics', () => {
  assert.match(hook, /approvalReason: catalogApprovalReason\(song, \$app\) \|\| null/)
  assert.doesNotMatch(hook, /approvalReason:.*metadata_json/)
})

test('review routes retain tablet authorization and transaction boundaries', () => {
  const individual = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/\{id\}\/review',[\s\S]*?\n}\)/)?.[0] || ''
  const batch = hook.match(/routerAdd\('POST', '\/api\/karaoke\/tablet\/catalog\/review\/batch',[\s\S]*?\n}\)/)?.[0] || ''
  assert.match(individual, /if \(!tablet\(auth\(c\)\)\)/)
  assert.match(batch, /if \(!tablet\(auth\(c\)\)\)/)
  assert.match(individual, /\$app\.runInTransaction\(\(tx\)/)
  assert.match(batch, /\$app\.runInTransaction\(\(tx\)/)
  assert.match(individual, /review_history_json/)
  assert.match(batch, /batch_review_summary/)
})
