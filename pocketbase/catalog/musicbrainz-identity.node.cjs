'use strict'
const test = require('node:test'); const assert = require('node:assert/strict')
const fs = require('node:fs')
const { parseYouTubeTitle, evaluateCandidates, createMatcher, USER_AGENT } = require('./musicbrainz-identity.cjs')

test('parses artist/title and never uses uploader metadata', () => {
  const parsed = parseYouTubeTitle('Queen - Bohemian Rhapsody (Karaoke)')
  assert.equal(parsed.artist, 'Queen'); assert.equal(parsed.title, 'Bohemian Rhapsody')
  assert.equal(parseYouTubeTitle('Uploader Channel - Live Medley').status, 'deferred')
})

test('fails closed on covers, remixes, live and malformed titles', () => {
  for (const title of ['Artist - Song Cover', 'Artist - Song Remix', 'Artist - Song Live', 'just a title']) assert.equal(parseYouTubeTitle(title).status, 'deferred')
})

test('returns high-confidence match and separate runner-up with release evidence', () => {
  const parsed = parseYouTubeTitle('Beyoncé - Halo')
  const result = evaluateCandidates(parsed, [
    { id: 'good', title: 'Halo', 'artist-credit-phrase': 'Beyoncé', releases: [{ id: 'release-1', title: 'I Am... Sasha Fierce', date: '2008' }] },
    { id: 'other', title: 'Halo', 'artist-credit-phrase': 'Other Artist' },
  ])
  assert.equal(result.decision, 'matched'); assert.equal(result.recording.id, 'good'); assert.equal(result.runnerUp.id, 'other'); assert.equal(result.recording.releases[0].id, 'release-1')
})

test('defers near ties, collisions and no results', () => {
  const parsed = parseYouTubeTitle('Artist - Song')
  assert.equal(evaluateCandidates(parsed, [{ id: 'a', title: 'Song', 'artist-credit-phrase': 'Artist' }, { id: 'b', title: 'Song', 'artist-credit-phrase': 'Artist' }]).reason, 'near_tie')
  assert.equal(evaluateCandidates(parsed, []).reason, 'no_results')
})

test('uses durable cache and one-request-per-second gate with identifying UA', async () => {
  const values = new Map(); let calls = 0; let now = 0; const headers = []
  const matcher = createMatcher({ clock: () => now, cache: { get: async (key) => values.get(key), set: async (key, value) => values.set(key, value) }, fetchJson: async (_url, requestHeaders) => { calls++; headers.push(requestHeaders); return { recordings: [{ id: 'r', title: 'Song', 'artist-credit-phrase': 'Artist' }] } } })
  const first = await matcher('Artist - Song'); const second = await matcher('Artist - Song');
  assert.equal(first.decision, 'matched'); assert.equal(second.cacheHit, true); assert.equal(calls, 1); assert.equal(headers[0]['User-Agent'], USER_AGENT)
})

test('PocketBase route exposes immutable apply binding, durable lease, and dry-run cache-miss guard', () => {
  const hook = fs.readFileSync(require('node:path').join(__dirname, '..', 'pb_hooks', 'party_queue.pb.js'), 'utf8')
  assert.match(hook, /const \{ auth, tablet, json, body, now, id, str, num, hash, set, setJson, jsonValue, correctCatalogIdentity \} = globalThis\.__partyQueue/)
  assert.match(hook, /!payload && dryRun.*dry_run_cache_miss/)
  assert.match(hook, /snapshot_binding_required/)
  assert.match(hook, /runInTransaction\(\(tx\) => .*__rate__/s)
  assert.match(hook, /expires_at/)
  assert.match(hook, /action: 'identity_correction'/)
  assert.match(hook, /correctCatalogIdentity/)
})
