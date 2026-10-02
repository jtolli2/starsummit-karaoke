# Queue Reordering Reliability and Tablet Touch Drag Handles

## Status

Implementation Ready — local work reviewed; operational closeout approved, storage verification and live validation pending

## Goals

- Reproduce and verify queue reordering before playback, during playback, and after completion.
- Preserve concurrent guest additions, keep the playing row fixed, reconcile stale snapshots, and show authoritative order.
- Repair reliability first, then add touch drag handles to `/tablet`; retain Up/Down controls as fallback.
- Produce meaningful Vue and pinned PocketBase 0.39.7 behavioral evidence and independent review.

## Constraints and Notes

- User approved all named closeout actions on 2026-10-02: commit exactly the eight feature files on main, push to jtolli2/starsummit-karaoke, deploy that exact product SHA to retained staging app wyxit9qifbwgskjrwibxb330 after verifying its retained PocketBase volume, then create an isolated staging party/guest queue with existing approved songs and validate reorder before/during/after real Fire-tablet/SmartTube playback. No deletion, catalog edits, paid YouTube lookups, Lounge re-pairing, production changes, or unrelated configuration changes are authorized.
- Preserve existing dirty workflow/documentation files and completed pairing recovery. Prior pairing approvals do not apply.
- No reorder audit metadata, generic drag framework, speculative contracts, unrelated playback/guest/catalog changes, or accessibility expansion.
- Parent owns integrated validation. Required pipeline: explorer, planner, bounded coder, independent tester, task reviewer, final reviewer.
- Completed pairing evidence remains in `context/feature-history.md`; prior active record is preserved at `/tmp/starsummit-reorder-tools-20261001/prior-current-feature.md`.

## Implementation Decisions

- Verified checkout: `main`, HEAD `2d971f71a1a864de5c4d8aba98c024306f8cd4ec`. Initial diff contains only pre-existing workflow/documentation edits listed in the handoff; preserve them.
- Existing consumers: `/tablet` uses `useTabletOperator.moveQueueItem`, which calls `tabletApi.reorderTabletQueue`; endpoint `POST /api/karaoke/tablet/queue/reorder` uses `partyId`, `queueId`, `direction`, `expectedRevision`, `expectedDigest`. Tablet status provides snapshot revision/digest. Guest request paths append sequence values; queue next/transition consumes queued sequence.
- Existing authorization remains constrained `tablet_admin` and party ownership. No schema, collection, migration, auth-role, realtime-topic, Android service/IPC/lifecycle/Keystore changes are proposed.
- Confirmed frontend baseline failure: `refresh()` returns immediately during an existing refresh. Parent-authored `tabletQueueReorder.spec.ts` holds a pre-mutation focus GET, completes reorder POST, then releases the old GET; baseline test fails expected 4 fetch calls versus actual 3. The postmutation authoritative read is skipped. Red command: `bun test:unit --run src/__tests__/tabletQueueReorder.spec.ts`; log `/tmp/starsummit-reorder-tools-20261001/frontend-race-red.log` (22:25:42 local). Repair must wait for any old read, issue a new read, and report uncertainty if it fails.
- Pinned runtime baseline: explorer used normal controller grant/enroll/session/state and queue start/completion endpoints. Adjacent reorder returned 200 before playback, during playback (playing sequence fixed), and after completion; pre-completion and pre-guest-addition snapshots returned 409 `stale_reorder`, preserving all rows. No backend playback/completion reorder defect reproduced. Reproduction: `/tmp/starsummit-reorder-tools-20261001/reorder-playback-repro.cjs`; retained fixture `playback-case-MmuSVp` with server stopped.
- Approved planner checkpoint: extend the existing reorder request with `targetQueueId`, mutually exclusive with `direction`. Consumers: `/tablet` pointer drop -> `useTabletOperator` -> `tabletApi` -> existing reorder endpoint. Drop places the moved queued row at target's prior queued index (earlier target: before; later target: after). One atomic request is necessary for a multi-row gesture; chained adjacent requests can partially apply before a conflict. Existing direction payload and response remain supported.
- Backend minimal delta: preserve revision/digest, owner/active-party guards, queue_sequence and current sequence-slot model; vacate moved row to existing temporary high sequence, shift only crossed queued rows through the vacant slots, then fill the target slot. Playing/terminal rows and future guest append allocation remain intact.
- Frontend minimal delta: private in-flight-read coordination plus an authoritative post-reorder read and truthful uncertainty on read failure. Touch pointer capture/drop feedback/cancellation remains local to `/tablet`; cancel on snapshot change, pointer cancellation/lost capture, non-queued/no-op targets. No new component props/emits/shared composable/framework.
- Bounded coder owned production changes; parent authored the pre-repair RED regression, and the independent tester owned expanded tests and test-only corrections. Reliability RED/GREEN preceded touch edits; task and integrated final reviews are complete.
- Runtime dependency verified locally: `/tmp/starsummit-reorder-tools-20261001/pocketbase --version` reports 0.39.7; test data remains isolated and retained.

## Minimal Delta

- Baseline: existing Up/Down actions and transactional stale-snapshot swap implementation. Current consumers and boundaries are listed above; tablet baseline tests pass 10/10 and real-runtime lifecycle baseline passes.
- Expected delta: only evidence-backed reorder repair, feature-local touch handle interaction, and behavior/regression tests. Preserve playing rows, guest additions, party/auth boundaries, authoritative next selection, and pairing behavior.
- Deferred: SmartTube NowPlaying convergence, guest persisted-request reconciliation, physical QR/Chrome Open rehearsal, optional UI modularity refactor, live deployment/rehearsal.

## Validation and Handoff

- Baseline tablet behavior: `bun test:unit --run src/__tests__/tabletPage.spec.ts` passed 10/10.
- Baseline focused contracts: `node --test pocketbase/protocol/party_queue.node.cjs pocketbase/protocol/controller_freshness.node.cjs` passed 19/19; these include structural checks and do not replace runtime proof.
- Baseline broad backend without binary configured: 85 total, 69 passed, 3 failed, 13 skipped. Existing catalog structural failures at `catalog_hooks.node.cjs:153`, `:255`, `:301`; log `/tmp/starsummit-reorder-tools-20261001/backend-baseline.log`.
- Existing `party_queue.integration.node.cjs` failed 3/3 before reorder exercise from stale active-party/catalog/controller fixtures. Current isolated runtime reproduction passed and identifies fixture drift separately.
- Frontend race RED established before production changes; exact regression is now GREEN after coalesced reads and required authoritative follow-up. Captured session/party checks discard obsolete results.
- Coder implementation checks: focused tablet reorder/page/API tests 36/36 (including tester edits then present), production build/type-check, hook syntax, TS ESLint, composable/page Prettier, and diff whitespace passed.
- Quality baseline: unchanged `ttlMinutes` parameter triggers Oxlint; unchanged route filename triggers ESLint component-name warning; existing service formatting debt confirmed with a HEAD copy. No unrelated cleanup performed.
- Target selector counts property presence and rejects both fields (even if one is empty), none, and invalid/empty target strings. Direction behavior remains supported.
- Independent tester: focused tablet reorder/page/API tests passed 48/48. New `pocketbase/protocol/tablet_reorder.integration.node.cjs` passed 1/1 on actual PocketBase 0.39.7, using normal controller session/state and queue start/completion endpoints. Covers expiry/owner/auth, mutually exclusive selectors, stale revision/digest/completion snapshots, exact target placement before/during/after playback, playing-row and completed-record preservation, atomic concurrent guest request + target move with 200/409 outcome-specific order checks, unique sequence slots, and authoritative next selection. Syntax and diff checks passed.
- Local browser preview uses the actual tablet page with mocked endpoints and synthetic data only: real desktop pointer drag moved position 1 to 4 across three rows, playing row stayed fixed, authoritative mock order rendered. At 390×844, single-column layout had no horizontal overflow, ~54px handles, and normal page scrolling. This is desktop pointer/visual proof, not a physical touchscreen or real browser-to-PocketBase test.
- Local preview found title compression caused by the third action at 1280×720; fixed with page-local queued-row details above the action group, preserving mobile stacking. Final 1280×900 browser recheck fits titles/controls cleanly; screenshot `/tmp/starsummit-reorder-tools-20261001/ui-preview/screenshots/desktop-fixed-1280.jpg`. Preview servers stopped, fixtures/screenshots retained.
- Parent integrated checks after final production CSS and test-cleanup typing correction: `bun test:unit --run` passed all 94 tests in 7 files; `bun run build` passed type-check and production bundle; focused queue/controller contracts passed 19/19, hook syntax and diff whitespace passed.
- The reviewer found and the tester corrected a concurrency-test expected-list mismatch for the guest-first 409 branch. Focused 48/48 tests and pinned runtime 1/1 passed again. A deterministic stale-target case explicitly proves 409 -> fresh read -> successful retry. The actual parallel race accepts either valid 200 or stale 409 and checks order/preservation; its observed branch is not logged, so both parallel outcomes are not claimed as separately observed.
- New test-file Prettier passed after formatting; changed API test hunk conforms, while full service/API test files retain verified baseline formatting debt. Test cleanup TS2790 was corrected before the passing integrated build. Assignment review: no blocking findings; ready to complete with unlogged parallel race-winner observation noted. Integrated final review: no blocking findings; ready for local implementation closeout. Evidence boundaries and baseline failures are accurately documented; no additional checks requested.


## Files Changed

- `src/composables/useTabletOperator.ts`: coalesces overlapping status reads, waits for authoritative post-reorder state, ignores obsolete session/party responses, and reports failed reconciliation honestly.
- `src/services/tabletApi.ts`: preserves direction payloads and supports target-row requests through the existing endpoint.
- `pocketbase/pb_hooks/party_queue.pb.js`: validates exactly one selector and moves a queued row to the target's prior index atomically, using existing sequence slots and optimistic guards.
- `src/pages/tablet/index.vue`: adds local pointer handles, before/after feedback, cancellation, and readable queued-row actions with Up/Down fallback.
- `src/__tests__/tabletQueueReorder.spec.ts`, `src/__tests__/tabletApi.spec.ts`, `pocketbase/protocol/tablet_reorder.integration.node.cjs`: cover observable recovery, gestures, API payloads, and real-runtime ordering/concurrency/lifecycle behavior.
- `context/current-feature.md`: records the verified baseline, contracts/minimal delta, attributable validation, reviews, and approval-gated handoff.

## How It Connects

A queued-row button or pointer drop sends the tablet's revision and digest to the existing protected
PocketBase reorder endpoint. PocketBase validates the active snapshot and moves only queued sequence
slots in one transaction. The tablet waits for an authoritative status refetch before reporting
success; stale requests reconcile to the server's order, while unavailable reads report uncertainty.
Guest submissions continue through their validated request endpoints, and next-song selection uses
the resulting server sequence. Native playback and pairing retain their existing boundaries.

## Closeout Handoff

- Repository: `/Users/chefjeff/code/projects/starsummit-karaoke`; branch `main`; unchanged HEAD `2d971f71a1a864de5c4d8aba98c024306f8cd4ec`; no feature commit or PR created.
- Delivered local scope: reliable authoritative reorder refetch/uncertainty, atomic target-row placement on the existing endpoint, page-local pointer handles and layout, Up/Down fallback, and behavioral Vue/API/PocketBase tests. Production paths: `src/composables/useTabletOperator.ts`, `src/services/tabletApi.ts`, `src/pages/tablet/index.vue`, `pocketbase/pb_hooks/party_queue.pb.js`. Test paths: `src/__tests__/tabletQueueReorder.spec.ts`, `src/__tests__/tabletApi.spec.ts`, `pocketbase/protocol/tablet_reorder.integration.node.cjs`.
- No commit, push, merge, deployment, remote mutation, physical device action, paid YouTube lookup, or deletion performed. Local fixture databases and temporary evidence remain retained.
- Operational next steps are explicitly approved by the user on 2026-10-02: commit/push exactly the scoped product/tests/context work while preserving existing workflow edits; deploy that exact product SHA to retained Compose staging app `wyxit9qifbwgskjrwibxb330` after read-only verification of actual volume binding, then validate `/tablet` on the verified retained Fire device and isolated party. Storage verification remains a prerequisite; no volume replacement or unrelated mutation is authorized.
- Preserve the pre-existing dirty `.agents/skills/feature/`, `.agents/skills/closeout/`, `context/ai-interaction.md`, `context/coding-standards.md`, `context/agent-workflow-feedback.md`, `context/validation-runbook.md` and their untracked actions. Ten preserved workflow-file hashes were checked unchanged against the saved manifest. Preserve retained PocketBase external volume, enrollment/controller/Lounge/party/queue/catalog/matcher data; no cleanup is authorized.
- Residual validation: local browser used mocked endpoints; physical touchscreen and retained staging remain untested. Broader backend baseline includes three unrelated catalog assertions and legacy party integration fixture failures; focused real-runtime reorder evidence is distinct.
- Deferred backlog: SmartTube authoritative NowPlaying recovery, guest persisted-request/error reconciliation, repeatable party rehearsal including physical QR and Chrome Open, optional small UI modularity refactor.

## Closeout Preflight — 2026-10-01

- User invoked and approved the closeout skill, then answered “approved for all” on 2026-10-02 to the named commit/push, exact-SHA staging deployment with volume preservation, and isolated physical playback validation scope. Those operational actions have not yet been performed at this checkpoint.
- Fresh read-only `git ls-remote origin refs/heads/main` confirms remote `main` remains `2d971f71a1a864de5c4d8aba98c024306f8cd4ec`, matching the reviewed local baseline.
- Coolify app `wyxit9qifbwgskjrwibxb330` reports `running:healthy`; its latest finished deployment records product SHA `fbb9c75346c6c81867588d6d2e931bfaf41b8450`. Configured commit metadata is distinct from deployed product evidence.
- Storage preflight is unresolved: Coolify storage record id 2 and its rendered Compose mount name `wyxit9qifbwgskjrwibxb330_pocketbase-data` at `/pb/pb_data`, while historical retained-volume evidence names `ggkfvh2tpdprcocn1sycu8zf`. Repository Compose requires an explicitly supplied external volume. The running container's actual binding has not been verified; do not infer a replacement occurred or deploy/change storage from these records alone.
- No credentials or sensitive environment values were displayed. No commit, push, deployment, storage change, device action, remote data change, or deletion occurred during preflight.

## Authorized Operational Progress — 2026-10-02

- Committed exactly the eight approved feature paths as `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f` (`feat(tablet): support touch queue reordering`) and pushed `main` to `github.com/jtolli2/starsummit-karaoke`. Fresh remote verification matches that SHA. Unrelated workflow/documentation edits and untracked files remain preserved; no PR or deletion occurred.
- Deployment has not started. Public staging `/tablet` and `/api/health` both return HTTP 200; latest finished deployment still records `fbb9c75346c6c81867588d6d2e931bfaf41b8450`.
- Actual-volume verification access remains unresolved: local Docker daemon is unavailable, SSH to the existing staging host rejects authentication, and CLI/API application/storage reads expose saved configuration rather than running Docker mounts. No volume or application configuration was changed.
- Read-only `adb devices -l` verifies reachable Fire tablet `192.168.0.244:5555`, model `KFTRWI`, product/device `trona`. No physical playback or queue action has been performed during this closeout.
- Existing local validation/review remains attributable to the committed product/test diff: 94/94 Vue tests, build/type-check, pinned PocketBase reorder integration 1/1, focused contracts 19/19, and final review without blockers. No production code changed during closeout.

- Signed commit verification reports `G` (valid signature) for product SHA `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f`.
- Independent browser preflight: Chrome Starsummit Development profile has authenticated staging operator UI at `/admin`, connected/paused controller, existing empty active party, and no active playback. Backend role is not exposed by the UI, so `tablet_admin` role has not been independently confirmed this run. Coolify tab in Jeffrey profile is signed out. Human sign-in was requested solely to enable read-only running-volume verification; existing operational approval remains valid.
- Exact-SHA deployment plan, after mount verification: installed CLI lacks a git-commit update flag; official Coolify API supports `PATCH /applications/{uuid}` with `git_commit_sha`, followed by CLI deployment of the approved app UUID. Restrict any eventual patch to that approved product SHA and preserve storage/configuration. No patch or deploy has been performed.

## Running Volume Reconciliation — 2026-10-02

- Human sign-in restored authenticated Coolify UI access in Chrome Starsummit Development profile. Sole browser owner used its host terminal for read-only Docker projections.
- Running PocketBase container `36f4cc3a2f32`, name `wyxit9qifbwgskjrwibxb330-pocketbase-1`, image `wyxit9qifbwgskjrwibxb330-pocketbase`, mounts Docker volume `xbqbuq8gvckl7r2hgi6yabws_pocketbase-data` from `/var/lib/docker/volumes/xbqbuq8gvckl7r2hgi6yabws_pocketbase-data/_data` at `/pb/pb_data`. This is the actual retained data source to preserve.
- Saved Coolify rendered mount and storage record still name `wyxit9qifbwgskjrwibxb330_pocketbase-data`. The non-secret `POCKETBASE_VOLUME_NAME` configuration names `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data` (hyphen), which also differs from the actual volume (underscore). Historical `ggkfvh2tpdprcocn1sycu8zf` is not current runtime evidence.
- Running container's Compose-file label identifies `/data/coolify/applications/wyxit9qifbwgskjrwibxb330/docker-compose.yaml`. Read-only effective configuration and raw-mode state checks are in progress before choosing any correction.
- No deployment/configuration/volume/playback changes have occurred. Deploying without resolving the prospective mount could attach different data; authorized live validation remains pending.

- Read-only host reconciliation is complete: effective `/data/coolify/applications/wyxit9qifbwgskjrwibxb330/docker-compose.yaml` volume configuration resolves `pocketbase_data` at `/pb/pb_data` to external volume `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`, differing from actual running underscore-named volume. Raw Compose Deployment is enabled. Saved normal-render storage metadata is not the raw deployment source.
- Concrete minimal correction prepared: update only non-preview environment setting `POCKETBASE_VOLUME_NAME`, UUID `crqbivyw05uxwo3mu8z8bscj`, from `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data` to `xbqbuq8gvckl7r2hgi6yabws_pocketbase-data`, keeping existing runtime/build availability. Existing raw Compose external-volume declaration then attaches the verified running data source. No data movement, volume creation/replacement/deletion, or deployment-mode change is proposed.
- User approval requested for this newly discovered remote configuration correction, per explicit configuration-mutation boundary. Previously approved exact-SHA staging deployment and isolated live validation remain authorized and pending that prerequisite. No correction, SHA pin, deployment, or live test mutation has yet occurred.

## Approved Deployment — 2026-10-02

- User explicitly approved the volume-name correction. Updated only non-preview `POCKETBASE_VOLUME_NAME` setting UUID `crqbivyw05uxwo3mu8z8bscj` to verified actual Docker volume `xbqbuq8gvckl7r2hgi6yabws_pocketbase-data`; read-back confirmed. The CLI mutation returned non-JSON success text despite its format flag, so the projection failed; the read-back verified application before any retry. No duplicate mutation was attempted.
- Pinned retained staging app `wyxit9qifbwgskjrwibxb330` to signed product SHA `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f` through the supported API because installed CLI lacks the commit flag. Read-back confirmed the exact SHA.
- Triggered the already-approved deployment via Coolify CLI, deployment UUID `it5qhnixqbwstjelzedjy5ld`. Deployment completion, postdeployment running mount/health, and isolated playback validation remain pending. No volume creation/replacement/deletion or data movement was requested.

- Deployment `it5qhnixqbwstjelzedjy5ld` failed at the selected product SHA with `external volume "xbqbuq8gvckl7r2hgi6yabws_pocketbase-data" not found`. Postfailure app status is `exited:unhealthy`; staging `/api/health` returns HTTP 503. Live validation has not begun.
- The engine lookup contradicts the prior visual terminal report of an underscore-named runtime volume. Exact read-only lookups of both names and remaining-container inspection are required before correction/recovery; no blind retry, alternate-volume creation, data movement, deletion, or playback action is authorized or performed.

## Volume Evidence Correction and Recovery Plan — 2026-10-02

- Exact Docker volume lookups resolve the discrepancy: `xbqbuq8gvckl7r2hgi6yabws_pocketbase-data` does not exist; `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data` exists. Earlier underscore-named live-mount report was an incorrect visual reading of the terminal screenshot. Parent accepted that report without an exact existence check; it is superseded and must not be used as retained-volume evidence.
- After the failed deployment, `docker ps -a` filtered by the approved app UUID shows no matching container rows. Existing hyphen-named Docker volume remains present; data integrity has not yet been checked through a restarted app.
- Concrete recovery prepared: restore only non-preview `POCKETBASE_VOLUME_NAME` UUID `crqbivyw05uxwo3mu8z8bscj` to `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`, then retry exact approved product SHA `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f` on the same app. No new volume, data movement, deletion, or unrelated configuration change is proposed.
- Explicit approval requested for restoring the now-verified hyphen value because the preceding configuration approval named the incorrect underscore value. Recovery is pending; no retry or restoration has yet been performed. Subsequent runtime verification must use exact-name assertions, not a visual separator reading.

## Approved Recovery Retry — 2026-10-02

- User approved restoring the verified existing hyphen-named volume and retrying deployment. Restored non-preview `POCKETBASE_VOLUME_NAME` to `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`; exact API read-back confirmed. Product SHA pin remains `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f`.
- Retried deployment on retained app `wyxit9qifbwgskjrwibxb330` via CLI: deployment UUID `jk9krlmw68eng0nfyz520wh2`. Completion, health recovery, exact-name running mount assertion, and isolated playback validation remain pending. No new volume, movement of data, deletion, or unrelated configuration action was performed.

- Recovery retry `jk9krlmw68eng0nfyz520wh2` finished successfully with product SHA `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f`. Coolify reports `running:healthy`. Public `/tablet`, frontend `/api/health`, and controller ingress `/api/health` all return HTTP 200 after ingress settled. Initial postfinish requests briefly returned 503; subsequent reads confirmed recovery.
- Postdeployment exact-name mount verification is pending from the independent UI owner. Live mutation/rehearsal has not yet started.

- Independent postdeployment running mount verification passed with exact Boolean assertion `expected_volume_matches=true`: healthy container `wyxit9qifbwgskjrwibxb330-pocketbase-1` mounts existing Docker volume `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data` from `/var/lib/docker/volumes/xbqbuq8gvckl7r2hgi6yabws-pocketbase-data/_data` at `/pb/pb_data`. This exact check supersedes the earlier erroneous visual report.
- Read-only UI owner parked; an independent tester now owns all browser/device interactions for the explicitly approved isolated live validation. No production code changed during deployment/recovery.

## Small Live-Validation Follow-up — 2026-10-02

- Verified UI baseline: `/admin` and `/tablet` expose Create party only with absent/expired active status. Existing empty active party cannot be replaced in the normal UI; its complete invitation code/QR was not independently confirmed this run and is not needed to establish the creation blocker. Do not expire, clear, or mutate it to force a test, and do not export browser authentication or invoke hidden application functions.
- Minimal local delta prepared for review: expose the existing `createActiveParty` action in the active `/admin` party card as Create another party, using the same normal constrained endpoint and existing busy/loading controls. Existing parties remain active until normal expiry; creation selects only the new party for this operator view. No new props/emits/types/endpoints/schema/auth/shared lifecycle contracts or abstraction. Current consumers remain `/admin` and `/tablet` creation flows calling the existing service/backend contract; the added affordance has only `/admin` as consumer.
- Scope: only `src/pages/admin/index.vue` plus this context record. Required small-follow-up pipeline: bounded quick implementer, attributable build/whitespace checks, one independent task reviewer. No unrelated playback, queue, catalog, pairing, or role changes. This local follow-up is separate from deployed/reviewed queue product SHA `982ccab5`; commit/push/deployment of the additional file must be approved against its concrete reviewed diff before execution.

- Independent live tester preserved the existing empty party (suffix F5NM, 0 guests, no playing row, controller connected/paused) and performed no remote test mutations. Isolated lifecycle tests remain blocked by the absent active-party creation control. Device identity/version reverified; real-device touch and playback remain untested.
- Small local admin follow-up implemented using only existing `createActiveParty`: active party card adds a note that the current party remains active until expiry and Create another party, disabled for loading/busy. Existing expired-party control unchanged. `bun run build` and scoped diff check passed. Independent task review pending; no new test mirrors this reversible one-button affordance.

- New button attributes were formatted within the 100-character style limit; scoped diff whitespace check passed again. Build not repeated for formatting-only edits.
- Independent task reviewer found no blockers: existing normal creation flow selects the new party and backend writes only a new record, previous party remains untouched; active and expired controls are mutually exclusive and busy/loading gating is preserved. Assignment passes. Interactive new-party creation and subsequent live lifecycle/touch validation remain pending deployment approval.
- Prepared additional commit/push scope is exactly `src/pages/admin/index.vue` and `context/current-feature.md`, preserving all unrelated workflow edits. Subsequent deployment must use the resulting exact reviewed SHA on the same retained staging app with verified existing hyphen-named volume; no production changes, data deletion, or pairing work.
