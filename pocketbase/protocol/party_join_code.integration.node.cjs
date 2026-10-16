'use strict'

// Run against the pinned runtime with:
// POCKETBASE_BIN=/path/to/pocketbase node --test pocketbase/protocol/party_join_code.integration.node.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

async function startServer(bin, dataDir) {
  const port = 19700 + Math.floor(Math.random() * 200)
  const server = spawn(bin, ['serve', '--dir', dataDir, `--http=127.0.0.1:${port}`], { stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        return { server, base }
      }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  server.kill('SIGTERM')
  throw new Error(`PocketBase did not become healthy on port ${port}`)
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.once('exit', resolve)
    server.kill('SIGTERM')
  })
}

function api(base) {
  return async (url, method = 'GET', payload, token) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    let json = {}
    try {
      json = await response.json()
    } catch (_) {}
    return { status: response.status, json }
  }
}

function makeUser(email, username) {
  return {
    email,
    username,
    password: 'TabletPassword123!',
    passwordConfirm: 'TabletPassword123!',
    role: 'tablet_admin',
  }
}

test('join-code recovery is owner-scoped and the additive migration preserves legacy parties', {
  skip: !process.env.POCKETBASE_BIN,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-party-join-code-pb-'))
  const migrations = path.join(root, 'pb_migrations')
  fs.mkdirSync(migrations)
  for (const name of fs.readdirSync(path.join(__dirname, '..', 'pb_migrations'))) {
    if (name !== '1785002000_party_join_code.js') {
      fs.copyFileSync(path.join(__dirname, '..', 'pb_migrations', name), path.join(migrations, name))
    }
  }
  fs.cpSync(path.join(__dirname, '..', 'pb_hooks'), path.join(root, 'pb_hooks'), { recursive: true })
  const dataDir = path.join(root, 'pb_data')
  const bin = process.env.POCKETBASE_BIN
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  execFileSync(bin, ['superuser', 'upsert', 'join-code@test.invalid', 'CorrectHorseBatteryStaple123!', '--dir', dataDir], { stdio: 'pipe' })

  let runtime = await startServer(bin, dataDir)
  t.after(() => runtime.server.kill('SIGTERM'))
  let call = api(runtime.base)
  const superAuth = await call('/api/collections/_superusers/auth-with-password', 'POST', {
    identity: 'join-code@test.invalid',
    password: 'CorrectHorseBatteryStaple123!',
  })
  assert.equal(superAuth.status, 200, JSON.stringify(superAuth))
  const superToken = superAuth.json.token
  const ownerCreate = await call('/api/collections/users/records', 'POST', makeUser('owner@test.invalid', 'owner'), superToken)
  const foreignCreate = await call('/api/collections/users/records', 'POST', makeUser('foreign@test.invalid', 'foreign'), superToken)
  assert.equal(ownerCreate.status, 200, JSON.stringify(ownerCreate))
  assert.equal(foreignCreate.status, 200, JSON.stringify(foreignCreate))
  const ownerAuth = await call('/api/collections/users/auth-with-password', 'POST', {
    identity: 'owner@test.invalid', password: 'TabletPassword123!',
  })
  const foreignAuth = await call('/api/collections/users/auth-with-password', 'POST', {
    identity: 'foreign@test.invalid', password: 'TabletPassword123!',
  })
  assert.equal(ownerAuth.status, 200, JSON.stringify(ownerAuth))
  assert.equal(foreignAuth.status, 200, JSON.stringify(foreignAuth))

  // Seed a genuine pre-migration hash-only party owned by the second operator.
  const legacyCode = 'LEGACY01'
  const legacyParty = await call('/api/collections/karaoke_parties/records', 'POST', {
    code_hash: crypto.createHash('sha256').update(legacyCode).digest('hex'),
    code_hint: legacyCode.slice(-4),
    status: 'active',
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    created_by: foreignCreate.json.id,
    join_count: 0,
    queue_sequence: 0,
  }, superToken)
  assert.equal(legacyParty.status, 200, JSON.stringify(legacyParty))
  assert.equal(Object.hasOwn(legacyParty.json, 'join_code'), false)
  const preMigrationSchema = await call('/api/collections/karaoke_parties', 'GET', undefined, superToken)
  assert.equal(preMigrationSchema.status, 200, JSON.stringify(preMigrationSchema))
  const preMigrationRow = await call(`/api/collections/karaoke_parties/records/${legacyParty.json.id}`, 'GET', undefined, superToken)
  assert.equal(preMigrationRow.status, 200, JSON.stringify(preMigrationRow))

  await stopServer(runtime.server)
  const migrationSource = path.join(__dirname, '..', 'pb_migrations', '1785002000_party_join_code.js')
  fs.copyFileSync(migrationSource, path.join(migrations, '1785002000_party_join_code.js'))
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })
  // Exercise the migration's add-if-absent path as a second migration pass.
  fs.copyFileSync(migrationSource, path.join(migrations, '1785002010_party_join_code_repeat.js'))
  execFileSync(bin, ['migrate', 'up', '--dir', dataDir], { stdio: 'pipe' })

  runtime = await startServer(bin, dataDir)
  call = api(runtime.base)
  const postMigrationSchema = await call('/api/collections/karaoke_parties', 'GET', undefined, superToken)
  const postMigrationRow = await call(`/api/collections/karaoke_parties/records/${legacyParty.json.id}`, 'GET', undefined, superToken)
  assert.equal(postMigrationSchema.status, 200, JSON.stringify(postMigrationSchema))
  assert.equal(postMigrationRow.status, 200, JSON.stringify(postMigrationRow))
  const oldSchema = preMigrationSchema.json
  const newSchema = postMigrationSchema.json
  assert.equal(newSchema.listRule, oldSchema.listRule)
  assert.equal(newSchema.viewRule, oldSchema.viewRule)
  assert.equal(newSchema.createRule, oldSchema.createRule)
  assert.equal(newSchema.updateRule, oldSchema.updateRule)
  assert.equal(newSchema.deleteRule, oldSchema.deleteRule)
  assert.deepEqual(newSchema.indexes, oldSchema.indexes)
  assert.deepEqual(newSchema.fields.filter((field) => field.name !== 'join_code'), oldSchema.fields)
  const joinFields = newSchema.fields.filter((field) => field.name === 'join_code')
  assert.equal(joinFields.length, 1)
  assert.equal(joinFields[0].type, 'text')
  assert.equal(joinFields[0].required, false)
  assert.equal(joinFields[0].hidden, true)
  assert.equal(joinFields[0].max, 8)
  assert.equal(postMigrationRow.json.code_hash, preMigrationRow.json.code_hash)
  assert.equal(postMigrationRow.json.code_hint, preMigrationRow.json.code_hint)
  assert.equal(postMigrationRow.json.status, preMigrationRow.json.status)
  assert.equal(postMigrationRow.json.expires_at, preMigrationRow.json.expires_at)
  assert.equal(postMigrationRow.json.created_by, preMigrationRow.json.created_by)
  assert.equal(postMigrationRow.json.join_code, '')

  const ownerLogin = await call('/api/collections/users/auth-with-password', 'POST', {
    identity: 'owner@test.invalid', password: 'TabletPassword123!',
  })
  const foreignLogin = await call('/api/collections/users/auth-with-password', 'POST', {
    identity: 'foreign@test.invalid', password: 'TabletPassword123!',
  })
  assert.equal(ownerLogin.status, 200, JSON.stringify(ownerLogin))
  assert.equal(foreignLogin.status, 200, JSON.stringify(foreignLogin))
  const ownerToken = ownerLogin.json.token
  const foreignToken = foreignLogin.json.token

  const createdA = await call('/api/karaoke/parties', 'POST', {}, ownerToken)
  const createdB = await call('/api/karaoke/parties', 'POST', {}, ownerToken)
  assert.equal(createdA.status, 201, JSON.stringify(createdA))
  assert.equal(createdB.status, 201, JSON.stringify(createdB))
  assert.match(createdA.json.code, /^[A-Z0-9]{8}$/)
  assert.match(createdB.json.code, /^[A-Z0-9]{8}$/)
  assert.notEqual(createdA.json.code, createdB.json.code)

  // Make expiry order differ from creation order to prove selection remains expiry-based.
  const expiryA = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const expiryB = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  assert.equal((await call(`/api/collections/karaoke_parties/records/${createdA.json.id}`, 'PATCH', { expires_at: expiryA }, superToken)).status, 200)
  assert.equal((await call(`/api/collections/karaoke_parties/records/${createdB.json.id}`, 'PATCH', { expires_at: expiryB }, superToken)).status, 200)
  const reauthenticatedOwner = await call('/api/collections/users/auth-with-password', 'POST', {
    identity: 'owner@test.invalid', password: 'TabletPassword123!',
  })
  assert.equal(reauthenticatedOwner.status, 200, JSON.stringify(reauthenticatedOwner))
  const reloadedOwnerToken = reauthenticatedOwner.json.token

  assert.ok([401, 403].includes((await call('/api/karaoke/tablet/active')).status))
  assert.ok([401, 403].includes((await call(`/api/karaoke/tablet/status?partyId=${createdA.json.id}`)).status))
  const active = await call('/api/karaoke/tablet/active', 'GET', undefined, reloadedOwnerToken)
  assert.equal(active.status, 200, JSON.stringify(active))
  assert.equal(active.json.party.id, createdA.json.id)
  assert.equal(active.json.party.code, createdA.json.code)
  const statusA = await call(`/api/karaoke/tablet/status?partyId=${createdA.json.id}`, 'GET', undefined, reloadedOwnerToken)
  const statusB = await call(`/api/karaoke/tablet/status?partyId=${createdB.json.id}`, 'GET', undefined, reloadedOwnerToken)
  assert.equal(statusA.status, 200, JSON.stringify(statusA))
  assert.equal(statusB.status, 200, JSON.stringify(statusB))
  assert.equal(statusA.json.party.code, createdA.json.code)
  assert.equal(statusB.json.party.code, createdB.json.code)
  const persisted = await call(`/api/collections/karaoke_parties/records/${createdA.json.id}`, 'GET', undefined, superToken)
  assert.equal(persisted.status, 200, JSON.stringify(persisted))
  assert.equal(persisted.json.join_code, createdA.json.code)

  // A foreign constrained operator retains status access, while active discovery is owner-scoped.
  const foreignStatus = await call(`/api/karaoke/tablet/status?partyId=${legacyParty.json.id}`, 'GET', undefined, ownerToken)
  assert.equal(foreignStatus.status, 200, JSON.stringify(foreignStatus))
  assert.equal(foreignStatus.json.party.id, legacyParty.json.id)
  assert.equal(Object.hasOwn(foreignStatus.json.party, 'code'), false)
  const foreignActive = await call('/api/karaoke/tablet/active', 'GET', undefined, foreignToken)
  assert.equal(foreignActive.status, 200, JSON.stringify(foreignActive))
  assert.equal(foreignActive.json.party.id, legacyParty.json.id)
  assert.equal(Object.hasOwn(foreignActive.json.party, 'code'), false, JSON.stringify(foreignActive))

  const legacyJoin = await call('/api/karaoke/parties/join', 'POST', { code: legacyCode })
  assert.equal(legacyJoin.status, 201, JSON.stringify(legacyJoin))
  assert.equal(legacyJoin.json.partyId, legacyParty.json.id)
  const guestActive = await call('/api/karaoke/tablet/active', 'GET', undefined, legacyJoin.json.credential)
  const guestStatus = await call(`/api/karaoke/tablet/status?partyId=${createdA.json.id}`, 'GET', undefined, legacyJoin.json.credential)
  assert.ok([401, 403].includes(guestActive.status), JSON.stringify(guestActive))
  assert.ok([401, 403].includes(guestStatus.status), JSON.stringify(guestStatus))

  assert.equal((await call(`/api/collections/karaoke_parties/records/${createdA.json.id}`, 'PATCH', {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }, superToken)).status, 200)
  const expiredCodedStatus = await call(`/api/karaoke/tablet/status?partyId=${createdA.json.id}`, 'GET', undefined, ownerToken)
  assert.equal(expiredCodedStatus.status, 200, JSON.stringify(expiredCodedStatus))
  assert.equal(Object.hasOwn(expiredCodedStatus.json.party, 'code'), false)
  assert.equal((await call(`/api/collections/karaoke_parties/records/${createdB.json.id}`, 'PATCH', {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }, superToken)).status, 200)
  const noOwnerActive = await call('/api/karaoke/tablet/active', 'GET', undefined, ownerToken)
  assert.equal(noOwnerActive.status, 200, JSON.stringify(noOwnerActive))
  assert.equal(noOwnerActive.json.party, null)

  assert.equal((await call(`/api/collections/karaoke_parties/records/${legacyParty.json.id}`, 'PATCH', {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }, superToken)).status, 200)
  const expiredStatus = await call(`/api/karaoke/tablet/status?partyId=${legacyParty.json.id}`, 'GET', undefined, foreignToken)
  assert.equal(expiredStatus.status, 200, JSON.stringify(expiredStatus))
  assert.equal(Object.hasOwn(expiredStatus.json.party, 'code'), false)
  const noForeignActive = await call('/api/karaoke/tablet/active', 'GET', undefined, foreignToken)
  assert.equal(noForeignActive.status, 200, JSON.stringify(noForeignActive))
  assert.equal(noForeignActive.json.party, null)
  assert.equal((await call('/api/karaoke/parties/join', 'POST', { code: legacyCode })).status, 410)

  t.diagnostic(`retained migration fixture: ${root}`)
})
