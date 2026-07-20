# PocketBase native controller protocol

This directory targets PocketBase **0.39.x**. Apply the migration in
`pb_migrations/1784500000_controller_protocol.js` and load
`pb_hooks/controller_protocol.pb.js` from the PocketBase `pb_hooks/` directory. The migration creates
all five protocol collections (and the constrained `users` auth collection) and the hook rejects
direct collection writes.

## Credential and operator boundary

An operator creates a short-lived enrollment grant using the superuser-only
`POST /api/karaoke/controllers/enrollment-grants` endpoint (or an equivalent local operator
script). PocketBase stores only the SHA-256 grant hash. The raw grant is shown once and is passed
to the device out-of-band. A grant can be redeemed exactly once by `POST /api/karaoke/controllers/enroll`.
The response contains the device auth identity and secret once; PocketBase stores the secret only in
its auth password hash. Revoking the `controller_devices` record immediately blocks device auth.

The browser tablet is a separate PocketBase auth account in the `users` collection with the
`tablet_admin` role. It never uses a controller-device credential, receives no device secret, and
cannot read or write Lounge pairing material. Only this role may issue commands.

## HTTP contract

All requests use the normal PocketBase auth bearer token. Device requests authenticate against the
`controller_devices` auth collection using the returned `deviceKey` (email identity) and
`deviceSecret` (password). `generation` is mandatory for device operations after session start.

| Endpoint | Caller | Request | Response |
| --- | --- | --- | --- |
| `POST /api/karaoke/controllers/enrollment-grants` | PB operator | `{ttlMinutes?}` | `{token, expiresAt}` (shown once) |
| `POST /api/karaoke/controllers/enroll` | unauthed device with grant | `{token, deviceName}` | `{deviceId, deviceKey, deviceSecret}` (shown once) |
| `POST /api/karaoke/controllers/sessions` | controller device | `{resumeSessionId?}` | `{id, generation, expiresAt, resumed}` |
| `POST /api/karaoke/controller-commands` | `tablet_admin` | `{deviceId, action, payload, idempotencyKey}` | sanitized command |
| `GET /api/karaoke/controllers/commands?sessionId=...&generation=...&after=...` | controller device | — | `{sessionId, generation, commands:[...]}` |
| `POST /api/karaoke/controllers/commands/:id/ack` | controller device | `{sessionId, generation, status, errorCode?}` | sanitized command |
| `PUT /api/karaoke/controllers/state` | controller device | `{sessionId, generation, connectionState, videoId?, playerState?, positionSeconds?, durationSeconds?, lastCommandSequence?}` | sanitized state |

Supported actions are `open_video` (`{videoId}`), `play`, `pause`, `seek` (`{seekSeconds}`), and
`get_now_playing` (empty payload). YouTube IDs must be exactly 11 URL-safe characters. Seek values
are finite seconds in the range 0–86400 and are rounded to milliseconds. Unknown fields are
dropped; Lounge tokens, cookies, API keys, and direct Lounge request capabilities are never stored.

Commands have a per-device monotonic `sequence`, a unique idempotency key, a 30-second expiry, and
`pending` → `succeeded`/`failed` terminal transitions. Repeating an acknowledgement with the same
terminal status is safe. A different status, stale generation, expired session, revoked device, or
expired command is rejected.
Resuming an unexpired session keeps the same session id and generation; a genuinely new session
increments the generation and marks older pending commands failed with `stale_session`.

## Realtime and refetch flow

PocketBase realtime is **Server-Sent Events (SSE)**, not WebSockets. The Android companion performs:

1. `GET /api/realtime` and waits for the `PB_CONNECT` event containing the realtime client id.
2. `POST /api/realtime` with `{"clientId":"...","subscriptions":["controller_commands/*"]}`
   (using its device bearer token) to authorize the own-device view rule.
3. On each `create`/`update` SSE notification, and after every reconnect, it refetches authoritative
   commands with the HTTPS `GET /api/karaoke/controllers/commands` endpoint and the last sequence.
   The endpoint always includes current-generation pending commands, even when their sequence is at
   or below `after`, so a lost acknowledgement can be reconciled and retried. Expired or terminal
   commands are omitted after expiry is recorded.

SSE notifications are hints only; reconnects and missed events are expected. A new session increments
the device generation, making all requests from an older session stale.

## Local checks

The isolated contract tests run without a PocketBase binary:

```sh
node --test pocketbase/protocol/controller_protocol.node.cjs
```

The integration harness requires a local PocketBase 0.39.7 binary and uses only temporary data:

```sh
POCKETBASE_BIN=/path/to/pocketbase \
  node --test pocketbase/protocol/controller_protocol.integration.node.cjs
```

For deployment, use the pinned PocketBase 0.39.x image/binary and run migrations before enabling the
frontend routes. The included container entrypoint runs `migrate up` against `/pb/pb_data` before
starting the server so versioned JavaScript migrations are not skipped. No live service or device
is touched by these tests.
