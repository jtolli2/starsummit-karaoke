# Frontend container deployment

The production Coolify application is a two-service Compose stack. `frontend` is the only
public service and serves the Vite build at `karaoke.app.starsummit.net`; it proxies `/api/`
and PocketBase realtime SSE to the private `pocketbase:8090` service. PocketBase keeps its
existing stateful data in the named `pocketbase_data` volume. Coolify's ingress terminates TLS
and routes the hostname to frontend port 8080; neither service binds host ports 80 or 443.

Set `POCKETBASE_VOLUME_NAME` to the exact, pre-provisioned Coolify volume name; Compose marks it
external and fails rather than creating or binding an unapproved volume. `POCKETBASE_HOST` is
configurable for deployments where the backend has a different private DNS name, and defaults to
`pocketbase:8090`. The proxy disables buffering and permits long-lived
reads so PocketBase SSE events reach browsers immediately. The frontend image is stateless and
can be replaced without touching the PocketBase volume.

## Retained staging Compose cutover

The approved staging topology is one Coolify Docker Compose application containing separate
`frontend` and `pocketbase` runtime containers. It reuses the exact pre-provisioned external
PocketBase volume and does not initialize, copy, replace, or delete retained data. The frontend
reaches PocketBase only through the stack-private `starsummit-pocketbase-internal:8090` alias.

Before attaching the retained volume:

1. Generate and verify a PocketBase backup on the existing volume.
2. Configure the Compose application with the exact external volume name and server-only YouTube
   variables.
3. Build the new stack without starting PocketBase.
4. Stop the standalone PocketBase application, then start the Compose stack so only one PocketBase
   process can ever mount the SQLite volume.
5. Route `karaoke-test.app.starsummit.net` to `frontend:8080` and
   `controller-test.app.starsummit.net` to `pocketbase:8090`.
6. Verify volume identity, backup presence, retained records, controller enrollment/session
   recovery, same-origin API/SSE, and both public health checks.

Keep the former applications stopped as rollback references until the Compose rehearsal succeeds.
Their deletion and any volume cleanup remain separately approval-gated and are not part of the
cutover.

## Header and access boundary

Only Coolify's trusted ingress may set `X-Forwarded-Proto`; the frontend accepts that header only
when its value is exactly `http` or `https`, otherwise it falls back to the direct connection
scheme. The frontend is not an independent public ingress and must not bypass Coolify's access
controls. It sends the backend the trusted Coolify ingress peer as `X-Forwarded-For` rather than
appending an unverified client-supplied chain; PocketBase remains private behind that boundary.

For retained staging, Coolify owns both hostnames and TLS. Raw Compose mode is required so Coolify
does not rewrite the approved external volume. Because Raw Compose also omits the generated proxy
attachment, both services join the existing external `coolify` network for their approved ingress
routes and their Traefik labels explicitly select that network. A separate internal Compose network
provides stack-isolated frontend-to-PocketBase DNS; the unique alias prevents collisions with
generic service names on the shared proxy network. No step may alter retained records, controller
enrollment, tablet pairing, or the external volume contents except for an explicit backup.
