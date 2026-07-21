# Frontend Container and Same-Origin Routing

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Add a production-ready, stateless frontend container for the Vue/Vite application while keeping
  PocketBase as a separate stateful container with its existing persistent volume.
- Serve compiled static assets efficiently and make browser deep routes, including `/party/[code]`,
  fall back to `index.html` without converting missing static assets into successful SPA responses.
- Proxy same-origin `/api`, including PocketBase realtime SSE, to PocketBase with safe forwarded
  headers and streaming-friendly buffering and timeout settings.
- Add health checks and local/container integration coverage for frontend serving, deep routes,
  API proxying, SSE streaming, and the absence of client-visible secrets.
- Document the exact eventual Coolify topology for `karaoke.app.starsummit.net` and a safe,
  approval-gated retained-staging topology that preserves its backend application, volume, records,
  controller enrollment, and tablet state.

## Constraints and Notes

- No commit, push, deployment, Coolify/DNS/resource change, remote record mutation, tablet action,
  volume replacement, or deferred Wi-Fi interruption test is authorized in this feature.
- Browser code must never expose PocketBase superuser, YouTube, Lounge, or controller credentials.
  Guest API and queue semantics remain unchanged; no initial library import is included.
- The retained `starsummit-pocketbase-test` application is PocketBase-only and healthy at
  `https://controller-test.app.starsummit.net/api/health`; it must remain untouched until a
  separately approved configuration plan is executed.
- Architecture decision: use a multi-stage Bun-to-Nginx frontend image. It is the only public
  service and proxies `/api` directly to the private PocketBase service. SPA routes fall back to
  `index.html`; assets and root static-file extensions return 404 when missing. Realtime proxying
  disables buffering and uses one-hour read/send timeouts.
- Persistent PocketBase storage is an explicitly named, pre-existing external Docker volume via
  the required `POCKETBASE_VOLUME_NAME`; the Compose file fails closed rather than creating an
  empty replacement volume. Coolify terminates TLS; only validated `X-Forwarded-Proto` values are
  preserved, and untrusted forwarded-client chains are not passed to PocketBase.
- Validation passed on 2026-07-21: `bun run test:frontend-container` (Docker build/static/deep
  route/API/SSE/bundle-secret checks), `bun test:unit --run` (3 files, 5 tests), `bun run build`,
  and `POCKETBASE_VOLUME_NAME=retained-test-volume docker compose -f compose.coolify.yml config`.
  Independent review approved the final diff with no P0-P3 findings. No remote resource, DNS,
  deployment, volume, record, controller, tablet, or Wi-Fi-interruption action was performed.
- Approved staging delivery evidence (2026-07-21): pushed commit `7f55f116cf4205fd52b57ab6a34184eeec7a3b0c`;
  redeployed the retained `starsummit-pocketbase-test` application against its existing persistent
  volume and assigned it the stable private alias `pocketbase-staging`. Created the separate
  `starsummit-karaoke-frontend-test` Coolify application (`f3b92sq9dy8y5ernb1nw9cfs`) at
  `https://karaoke-test.app.starsummit.net`, with proxy target `pocketbase-staging:8090`.
  Deployment health, `/healthz`, deep-route SPA fallback, API health,
  asset 404, browser guest route, and realtime SSE all passed. No record, volume, controller,
  tablet, production hostname, or Wi-Fi-interruption mutation was performed.
