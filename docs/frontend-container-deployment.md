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

## Retained staging application (approval-gated)

The existing `starsummit-pocketbase-test` Coolify application is PocketBase-only and must remain
untouched. Its records, controller enrollment, tablet state, and predefined persistent volume are
retained as-is. Do not add a public frontend route, replace its volume, or mutate its deployment
without separate written approval.

Before any staging browser validation, choose and approve exactly one migration path:

1. Create a new same-stack frontend + PocketBase composition and perform a reviewed data/volume
   migration with a backup and rollback plan; or
2. Create a separate frontend application attached to the existing private network, configured
   with the full renamed PocketBase container name (not a guessed short service name), while
   leaving the existing application and volume unchanged.

The staging plan is documentation only. DNS, Coolify applications, networks, volumes, secrets,
deployments, and records are approval-gated and are intentionally not changed by this repository.

## Header and access boundary

Only Coolify's trusted ingress may set `X-Forwarded-Proto`; the frontend accepts that header only
when its value is exactly `http` or `https`, otherwise it falls back to the direct connection
scheme. The frontend is not an independent public ingress and must not bypass Coolify's access
controls. It sends the backend the trusted Coolify ingress peer as `X-Forwarded-For` rather than
appending an unverified client-supplied chain; PocketBase remains private behind that boundary.

For retained staging, the proposed unique frontend hostname is
`karaoke-test.app.starsummit.net` (approval required). Before execution, read-only verification
must confirm the current Coolify project, private network, frontend service port, and exact
PocketBase container DNS name. The approved runbook would then create the frontend application,
attach it to that predefined network, set `POCKETBASE_HOST` to the full renamed PocketBase
container name plus port 8090, configure hostname/TLS, and run the healthcheck. No step may edit
the retained PocketBase application, records, controller enrollment, tablet state, or volume.
