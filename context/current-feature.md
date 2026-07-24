# Simplified Tablet Operator Interface

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Make `/tablet` a touch-first, playback- and queue-focused operator surface while preserving the
  existing constrained `tablet_admin` authorization and validated PocketBase endpoints.
- Keep the party identity, readable QR code, expiry/status, prominent authoritative Now Playing
  state, and a large confirmed-state Play/Pause toggle visible without navigating away.
- Add a queue drawer with fair-order/requester context and safe, confirmed everyday queue actions;
  keep destructive transitions confirmed and prevent duplicate submissions.
- Preserve the existing server-side queue/controller contracts, including durable playback
  idempotency, authoritative HTTPS refetch after SSE wake/reconnect, and clear mismatch/recovery
  presentation. Do not claim SmartTube acknowledgement proves convergence.
- Separate advanced party administration, catalog review/import, reports, diagnostics, and settings
  under `/admin`, reachable only through a discreet intentional handoff from `/tablet`.
- Add proportionate Vue tests for confirmed versus pending playback state, unavailable/mismatched
  controls, drawer/QR persistence, empty-party flow, confirmations, duplicate prevention, admin
  navigation, recovery, and accessible controls; then validate and independently review locally.

## Constraints and Notes

- Local edits and read-only inspection/validation are authorized. No commit, push, deployment,
  PocketBase/Coolify/staging/tablet mutation, deletion, reset, controller enrollment, credential
  change, or Wi-Fi interruption test is authorized.
- `/tablet` and `/admin` share only a constrained `tablet_admin` session. Browser code must not
  contain a PocketBase superuser, Lounge material, YouTube keys, Coolify secrets, raw privileged
  records, or direct collection writes.
- Existing queue, fair rotation, controller-generation, party/video ownership, validated endpoint,
  and SSE-wake/HTTPS-authority semantics are preserved. The known Lounge/SmartTube convergence
  blocker remains visible as mismatch/recovery state rather than being masked as success.

## Implementation Notes

- Moved the retained full administration/catalog surface to `/admin` and made `/tablet` a focused
  operator route backed by `useTabletOperator`. Both routes retain the same constrained
  `tablet_admin` session and validated API contracts.
- `/tablet` keeps party identity/QR visible with Now Playing, one authoritative Play/Pause control,
  a responsive queue drawer, confirmed terminal queue actions, and an intentional confirmation
  gate before Advanced Admin. Pending commands retain and reuse their scoped idempotency key after
  ambiguous delivery; acknowledgement alone never changes the confirmed Play/Pause label.
- The tablet status response now exposes only anonymous `Guest N` requester labels and a
  server-calculated fair-rotation projection. It does not expose raw guest records or credentials.
- Local validation passed: 37 Vue tests, production type-check/build, 20 focused queue/controller
  protocol tests, PocketBase hook syntax, Oxlint for changed Vue/tests, Prettier, diff checks, and
  secret scan. Independent review approved controller/idempotency, authorization, accessibility,
  fair-order, and regression boundaries after focused repairs.
- Responsive local-browser inspection at 800x1280 and 1280x800 found no horizontal overflow and
  54px touch controls. It covered the signed-out shell only because no local tablet account was
  available; authenticated behaviors are covered by Vue tests. No retained tablet/browser credential
  was used. Retained Compose staging deployment `v132wnb9acj2hoiahtfhee4v` imported product SHA
  `5eaf04e61395caca851db91d7f57a2abfeb227ce` and finished healthy; `/tablet`, same-origin
  `/api/health`, and controller `/api/health` each returned HTTP 200. SmartTube/Lounge convergence
  remains a known unresolved runtime limitation.
- Follow-up refinement: removed the document-level white gutter through the app stylesheet,
  consolidated Now Playing and icon-only playback/queue controls into one compact panel, and made
  the queue a right-side push drawer that expands the layout instead of overlaying playback content.
