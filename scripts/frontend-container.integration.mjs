import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'

const image = `starsummit-karaoke-frontend-test:${process.pid}`
let container
const backend = createServer((request, response) => {
  if (request.url === '/api' || request.url === '/api/health') {
    response.end(`backend-ok:${request.headers['x-forwarded-proto'] ?? ''}`)
    return
  }
  if (request.url === '/api/realtime') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.write('data: first\n\n')
    setTimeout(() => response.end('data: second\n\n'), 150)
    return
  }
  response.writeHead(404)
  response.end()
})

try {
  backend.listen(0, '0.0.0.0')
  await once(backend, 'listening')
  const backendPort = backend.address().port
  execFileSync('docker', ['build', '--tag', image, '--file', 'frontend/Dockerfile', '.'], { stdio: 'inherit' })
  const hostPort = 18080 + (process.pid % 1000)
  container = execFileSync('docker', [
    'run', '--detach', '--rm', '--publish', `${hostPort}:8080`,
    '--add-host', 'host.docker.internal:host-gateway',
    '--env', `POCKETBASE_HOST=host.docker.internal:${backendPort}`, image,
  ], { encoding: 'utf8' }).trim()

  const base = `http://127.0.0.1:${hostPort}`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const deep = await fetch(`${base}/party/demo-code`)
  if (!deep.ok || !(await deep.text()).includes('<div id="app">')) throw new Error('SPA fallback failed')
  if ((await fetch(`${base}/assets/missing.js`)).status !== 404) throw new Error('asset 404 failed')
  if ((await fetch(`${base}/missing.js`)).status !== 404) throw new Error('public file 404 failed')
  if ((await (await fetch(`${base}/api`, { headers: { 'x-forwarded-proto': 'https' } })).text()) !== 'backend-ok:https') throw new Error('API root proxy failed')
  if ((await (await fetch(`${base}/api/health`, { headers: { 'x-forwarded-proto': 'https' } })).text()) !== 'backend-ok:https') throw new Error('API proxy failed')
  const stream = await fetch(`${base}/api/realtime`, { headers: { 'x-forwarded-proto': 'https' } })
  const reader = stream.body.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  if (!first.includes('first')) throw new Error('SSE first chunk was not streamed')
  const second = new TextDecoder().decode((await reader.read()).value)
  if (!second.includes('second')) throw new Error('SSE second chunk was not streamed')
  const html = await (await fetch(`${base}/`)).text()
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)].map((match) => match[1])
  const assetBodies = await Promise.all(assetPaths.map(async (path) => (await fetch(`${base}${path}`)).text()))
  if (/AIza|superuser|loungeToken|youtubeApiKey/i.test([html, ...assetBodies].join('\n'))) throw new Error('client secret artifact found')
  console.log('frontend container integration checks passed')
} finally {
  if (container) {
    try { execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' }) } catch {}
  }
  backend.close()
}
