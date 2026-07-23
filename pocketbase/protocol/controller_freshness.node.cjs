'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const hook = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'controller_protocol.pb.js'), 'utf8')

test('authenticated controller resume and state reports refresh device liveness atomically', () => {
  const sessionRoute = hook.slice(hook.indexOf("routerAdd('POST', '/api/karaoke/controllers/sessions'"), hook.indexOf("routerAdd('POST', '/api/karaoke/controller-commands'"))
  const stateRoute = hook.slice(hook.indexOf("routerAdd('PUT', '/api/karaoke/controllers/state'"), hook.indexOf("routerAdd('POST', '/api/karaoke/controllers/enrollment-grants'"))
  assert.match(sessionRoute, /previous && number\(previous, 'generation'\) === currentGeneration[\s\S]*set\(txAuth, 'last_seen_at', now\(\)\); txApp\.save\(txAuth\)/)
  assert.match(stateRoute, /set\(device, 'last_seen_at', now\(\)\); txApp\.save\(device\)[\s\S]*set\(state, 'device'/)
})
