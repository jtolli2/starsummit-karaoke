# Tablet Operator Interface

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Deliver a touch-first `/tablet` operator route, authenticated only by a constrained
  `tablet_admin` application identity, with recoverable session handling and no browser superuser
  or controller credentials.
- Create and manage the active 12-hour party with server-generated high-entropy code, QR join URL,
  sanitized status/counts, and clear expired/revoked/reconnecting feedback.
- Render authoritative fair-rotation queue and controller state, and make validated, idempotent
  next/play, completion, skip/fail, and refresh recovery actions available to the operator.
- Hand off playback solely through the existing PocketBase controller command/session protocol and
  keep single-playing/monotonic transitions enforced server-side.
- Add focused Vue and pinned PocketBase coverage, independent review, retained-staging deployment,
  and live browser/API validation without the deferred Wi-Fi interruption test.

## Constraints and Notes

- `/admin` remains separate and is not introduced for this feature: `/tablet` combines the shared
  tablet display and the constrained operator controls, avoiding a duplicate privileged surface.
- Preserve retained staging volume, records, validation identity, synthetic devices, controller
  enrollment/state, and production resources. Do not expose secrets or perform destructive work.
- The delegated request grants feature-scoped approval for commits, pushes, retained-staging
  deployment/configuration, controlled validation records/accounts, and Fire tablet validation.
- Added `created_by` through a forward migration for reload-safe operator recovery. The browser
  stores only the constrained tablet token, active-party id, and locally created public join code
  in session storage; it never receives superuser, controller, or Lounge credentials.
- The controller must have a current-generation, connected heartbeat less than 90 seconds old
  before the server can atomically start an entry and issue its controller command. Expired parties
  reject every transition before mutation.
- Validation: focused Vitest coverage (13 tests), PocketBase protocol node tests (6), syntax and
  whitespace checks, and production build passed. Pinned PocketBase integration is environment
  gated locally because `POCKETBASE_BIN` is unavailable; retained staging remains the live route
  validation target. Independent review approved after the freshness repair.
