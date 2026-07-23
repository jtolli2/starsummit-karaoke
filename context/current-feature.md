# End-to-End Party Dress Rehearsal and Hardening

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Perform a fresh, isolated retained-staging party rehearsal: scoped guests, local search, one
  bounded fallback/cache replay where needed, fair queue behavior, wake/refetch recovery, tablet
  control, companion/SmartTube handoff, and approved recoverable restarts—without deletion, volume
  replacement, credential exposure, controller re-enrollment, or Wi-Fi interruption.
- Repair rehearsal-discovered UI, recovery, accessibility, authorization, or integration defects;
  deploy exact frontend/backend SHAs and record retained validation artifacts.
- Deliver `docs/go-live-party-checklist.md`, complete feature records, independent review, signed
  commit/push, and a concise evidence report.
- Add touch-focused Play and Pause controls to the constrained tablet operator, with party-scoped,
  fresh-controller, active-video, monotonic-command, and idempotency enforcement; validate both
  actions through the retained native companion and SmartTube.

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
- Retained staging was consolidated into Coolify Compose application
  `wyxit9qifbwgskjrwibxb330` at `0b0b4e4ed6f81db4b976aa44c3aca756de9db468` (deployment
  `f125y0ioinr462d5xiwb15to`). Raw Compose preserves the exact external volume
  `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`; explicit HTTPS labels and the single existing
  `coolify` proxy network route the frontend and controller domains, while an internal network and
  stack-unique alias isolate frontend-to-PocketBase traffic. Ten consecutive checks passed for
  controller health, frontend HTML, and the frontend same-origin API after the final deployment.
- The pre-cutover PocketBase backup `pre_compose_cutover_20260723.zip` (2.9 MB) remains visible
  after cutover, proving the retained data volume is mounted. The former frontend and PocketBase
  applications are stopped with their domains cleared as non-deleted rollback references. A
  parser-created unused Compose storage record/volume is also retained because cleanup was not
  authorized.
- Fresh rehearsal party `5VTUX3WJ` was created through `/tablet` for 12 hours and retained with
  four temporary guest identities. Three independent initial guests proved exact, typo, and
  artist/title local search; active duplicate rejection; one explicit high-confidence YouTube
  fallback; cached exact replay; fair requester rotation; and guest SSE wake followed by
  authoritative HTTPS refetch. One additional guest proved reload recovery without creating a
  second identity, completed-song re-request, and the 30-second request rate limit.
- Live rehearsal exposed two retained-runtime defects. Commit `a5161d5` canonicalizes controller
  cutoff filter dates for PocketBase 0.39.7, allowing the party to bind the single fresh controller.
  Commit `b45fa39` replaces blank terminal `active_song_key` values with unique
  `terminal:<queue-id>` sentinels, restoring both completed and failed transitions after the first
  terminal row while releasing the YouTube ID for re-request. It also restores the bounded
  `failure_reason` write and normalizes unexpected transition errors to `transition_failed`.
- Retained live transitions then succeeded in order: Never Gonna Give You Up completed; Bridge Over
  Troubled Water started in fair rotation and failed once with reason `Playback failed`; the
  high-confidence fallback started and completed; and Never Gonna Give You Up was requested and
  started again. The fallback command and re-request command each followed realtime wake,
  authoritative command refetch count 1, Lounge `setPlaylist` HTTP 2xx, terminal acknowledgement,
  and refetch count 0. Authoritative video IDs converged to `PAwS5zmPrHA` and then
  `nMDXPAM8RwE`.
- A controlled native companion process restart preserved enrollment and Lounge pairing. It
  re-established on attempt 1, accepted the realtime subscription, found zero pending commands,
  retained `PAwS5zmPrHA` at 74.3 seconds, and caused no duplicate playback or queue transition.
  Repeated Compose deployments likewise preserved the party, four guest identities, catalog,
  queue, controller enrollment, and external volume.
- Responsive inspection passed at a 390-by-844 guest viewport and a Fire-sized tablet viewport:
  no horizontal overflow, readable QR, clear playing/queued/error states, and touch-sized controls.
  The tablet now exposes only Play and Pause for the matching active video. Controls remain disabled
  while the controller is stale, unavailable, on another video, or already in the requested state.
- Latest product deployment `sehubojx93gmhadn0rj0xdrs` finished at
  `b45fa39baf3f09bcc141e342ba5643ad88138093`; controller and same-origin health returned 200.
  The Coolify CLI handled inspection, logs, and deployment verification. Direct API calls were used
  only to pin and enqueue the deployment because the installed CLI has no deploy/create command.
  No credential value was printed or persisted.
- Final independent re-review found the terminal-sentinel, authorization, transaction, fair
  rotation, and normalized-error design ready after one repair: `failure_reason` is now written only
  through a verified retained text-field contract, and its forward migration changes only safe text
  options. The remaining test caveat is that the local PocketBase 0.39.7 binary is unavailable, so
  nine pinned-runtime cases skip; real retained staging supplied the multi-terminal, re-request,
  process-restart, deployment-restart, and command/acknowledgement evidence instead.
- Final local validation passed 24 Vue tests, production type-check/build, 64 backend/protocol
  contracts with nine explicitly skipped pinned-runtime cases, hook/migration syntax, Compose
  interpolation with non-secret placeholders, diff checks, and scoped secret scans. Android source
  was not changed; live process restart evidence replaced an unnecessary APK rebuild.
- The final queue was left empty after completing the re-requested Rick Astley item. Party, guest,
  queue, fallback/search/cache, quota, catalog, controller, command, and audit records remain
  retained; no record, application, volume, backup, enrollment, or pairing was deleted or replaced.
- Tablet transport hardening was completed in signed commits `ddc2853`, `2ef0fda`, `65e0ef2`, and
  `8c6700d`. The endpoint binds each request to the tablet-owned active party, playing queue item,
  current controller generation, matching video, expected player state, operator, and a durable
  party/queue/action idempotency scope. Exact ambiguous retries reuse their persisted browser
  operation key; equivalent pending commands cannot cross party or queue scope; transient UI says
  requested until authoritative state confirms the action.
- Deployment `p12fz9ocnsd58frv8fwqd6to` finished at exact product SHA
  `8c6700d5f1c4d1e837daa53f61e83fb76548f42e`; both retained hostnames returned 200. Live Bridge
  validation showed Pause then Play as realtime wake, authoritative refetch count 1, Lounge command
  HTTP 2xx, terminal acknowledgement, and refetch count 0. Controller state converged from playing
  to paused and back to playing before Bridge was completed, leaving the active queue empty.
- The earlier automatic `open_video` command was acknowledged but SmartTube stayed on the completed
  fallback video. The approved manual companion Open Video fallback aligned Bridge
  (`KCI3qN_c3k0`), after which authoritative state and the new controls worked normally. This
  non-convergence remains a go-live observation rather than hidden success.
- Final validation passed 28 Vue tests, production type-check/build, 66 backend/protocol contracts
  with nine explicitly skipped pinned-runtime cases, hook/migration syntax, Compose validation,
  diff checks, and a scoped secret scan. Independent review returned APPROVE after repairs for
  durable retry identity, cross-party replay scope, old pending-command scope, stale pending UI,
  and pending-versus-confirmed messaging.
