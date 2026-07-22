'use strict'

// Read-only planning helper. It never contacts YouTube or PocketBase; pipe its
// JSON chunks to the protected import route when an operator chooses to import.
const fs = require('node:fs')
const path = require('node:path')
const { sourceFingerprint } = require('./importer.cjs')

const file = process.argv[2] || path.join(__dirname, 'fixtures', 'karaoke-manifest.json')
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const chunkSize = Math.max(1, Math.min(100, Number(process.argv[3] || 100)))
const manifestFingerprint = sourceFingerprint(manifest)
const chunks = []
for (let offset = 0; offset < manifest.items.length; offset += chunkSize) chunks.push({ manifestFingerprint, source: manifest.source, total: manifest.items.length, offset, items: manifest.items.slice(offset, offset + chunkSize) })
process.stdout.write(`${JSON.stringify({ manifestFingerprint, chunks }, null, 2)}\n`)
