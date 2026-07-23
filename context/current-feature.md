# End-to-End Party Dress Rehearsal and Hardening

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

In Progress

## Goals

- Perform a fresh, isolated retained-staging party rehearsal: scoped guests, local search, one
  bounded fallback/cache replay where needed, fair queue behavior, wake/refetch recovery, tablet
  control, companion/SmartTube handoff, and approved recoverable restarts—without deletion, volume
  replacement, credential exposure, controller re-enrollment, or Wi-Fi interruption.
- Repair rehearsal-discovered UI, recovery, accessibility, authorization, or integration defects;
  deploy exact frontend/backend SHAs and record retained validation artifacts.
- Deliver `docs/go-live-party-checklist.md`, complete feature records, independent review, signed
  commit/push, and a concise evidence report.

## Constraints and Notes

- Standing approval covers the scoped local work, commits/pushes to existing `main`, retained
  staging deployment/configuration/restarts, isolated validation records, and non-destructive
  tablet/companion/SmartTube actions. It does not cover deletion, volume replacement, production or
  DNS mutation, credential rotation, controller re-enrollment, factory reset, bulk catalog approval,
  paid commitments, or Wi-Fi interruption.

- No deletion or cleanup is authorized. Do not replace/remove the persistent volume, mutate
  production hostname/DNS, change unrelated Coolify resources, incur paid commitments, mutate the
  tablet/controller, perform destructive resets, or run the deferred Wi-Fi interruption test.
- Canonical artist/title may come only from MusicBrainz/source or constrained operator input.
  YouTube uploader/channel is separate provenance and must never populate canonical artist.

## Completion Notes

- 2026-07-22 baseline: staging frontend and PocketBase were both healthy at product SHA
  `b43d6ecc463dac34d0bfc4ee15465c061fdfc211`; no deployment, restart, data mutation, or volume
  operation was performed in this feature attempt.
- `YOUTUBE_API_KEY_BACKUP` failover is deliberately deferred from the MVP. The retained primary-key
  path is unchanged; a backup may be selected manually only during development if needed.
- The MVP adds the go-live checklist. Pinned runtime migration evidence, independent review, and the
  live rehearsal remain open.
- Local evidence: 44 backend contracts passed (9 pinned-runtime tests skipped without
  `POCKETBASE_BIN`), 24 Vue tests passed, and the production build passed.
- Rehearsal hardening deployed: `ba1c595` refreshes controller device liveness only from an
  authenticated session resume or authenticated state report, transactionally with the persisted
  state. This repairs the 90-second availability cutoff without changing enrollment or public
  access. The independent review also confirmed the prior state-report mutex repair.
- Staging proxy hardening deployed as `289745a`: the separately hosted PocketBase upstream now
  receives its own ingress host and TLS SNI, preventing same-origin `/api` requests from looping
  back to the frontend. Local Nginx syntax, Vue tests, and production build passed.
- The backend deployment `s14r0bxkr26cp75n6x2wen7b` finished at `ba1c595`. Frontend deployment
  `ptxi9xswsbgplge2i0qd2isz` was queued at `289745a`; while it was rebuilding, the retained
  staging host stopped completing TLS/SSH/API handshakes. Remote rehearsal evidence remains open
  until ingress and Coolify recover. No retained record, resource, or volume was deleted or
  replaced.
