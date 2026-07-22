#!/usr/bin/env node
'use strict'

const { SOURCE_TERMS, SOURCE_URL, digest, selectCorpus } = require('./listenbrainz-source.cjs')

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2)
  return [key, value]
}))
const limit = Math.min(5000, Math.max(1, Number(args.limit || 100)))
const perArtist = Math.min(25, Math.max(1, Number(args['per-artist'] || 8)))
const count = Math.min(1000, Math.max(limit, Number(args['source-count'] || limit)))
const ranges = String(args.ranges || 'all_time,year,half_yearly,quarter,month,this_week').split(',').map((value) => value.trim()).filter(Boolean)
const retrievedAt = new Date().toISOString()
const userAgent = 'StarsummitKaraoke/1.0 (https://github.com/jtolli2/starsummit-karaoke)'

async function main() {
  const lists = {}
  for (const range of ranges) {
    const url = `${SOURCE_URL}?range=${encodeURIComponent(range)}&count=${count}&offset=0`
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': userAgent } })
    if (!response.ok) throw new Error(`listenbrainz_http_${response.status}`)
    const payload = await response.json()
    lists[range] = Array.isArray(payload?.payload?.recordings) ? payload.payload.recordings : []
  }
  const items = selectCorpus(lists, { limit, perArtist })
  const manifest = {
    source: { url: SOURCE_URL, terms: SOURCE_TERMS, retrievedAt, ranges },
    policy: { market: 'US', languageFocus: 'English-first', perArtist, requestedLimit: limit, qualityStop: 'verified canonical identity only; no padding' },
    items,
  }
  manifest.manifestFingerprint = digest(manifest)
  manifest.quotaPlan = { searches: items.length, expectedUnits: items.length * 101, conservativeReservedUnits: items.length * 303 }
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
