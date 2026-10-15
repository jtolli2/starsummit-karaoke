# Queue Reordering Reliability and Tablet Touch Drag Handles

## Status

Deployed — live pre-playback reorder verified; controller association and Fire touch validation in progress

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

- Repository `/Users/chefjeff/code/projects/starsummit-karaoke`, branch `main`, signed HEAD/remote main `b9f8b515e393c45ba2efad50eb243a6da970a607`; no PR. Queue implementation commit `982ccab5fd6b8ffaff1bdb6ead5a790d3f5f3e6f`; additional reviewed admin creation control commit `b9f8b515`.
- Retained staging app `wyxit9qifbwgskjrwibxb330` deployed exact HEAD as finished deployment `t99g8i3zwhemk15gt9uii913`. Public frontend/API/controller health HTTP 200. Exact running mount assertion confirms existing `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data` at `/pb/pb_data`. Earlier failed underscore-name deployment and corrected evidence are documented below; do not reuse the erroneous volume identity.
- Delivered scope: authoritative reorder refresh/uncertainty, atomic target-row moves on existing endpoint, local touch handles and Up/Down fallback, behavior/runtime tests; admin exposes existing Create another party action to enable isolated normal UI testing without modifying prior parties.
- Reviewed local validation: 94/94 Vue tests, production build/type-check, pinned PB0.39.7 reorder runtime1/1, focused contracts19/19; no blocking reviews. Additional admin-only build and independent small-change review pass. Unrelated backend baseline failures remain separately documented.
- Live isolated party suffix JA4: four Catalog songs requested, desktop multi-row drag and Up/Down pass, subsequent guest addition survives fresh read. Before/during/after playback are not all verified: new party cannot bind the otherwise connected staging companion. Read-only diagnosis found 12 owned redeemed grants and no grant created field, while availability queries sort by -created and catch failures. The local query repair now passes pinned regression checks and final review; exact commit/push/deploy approval is pending. Existing authenticated Fire admin/tablet tabs show No active party; the reproduced recovery date query defect is included in the repair. Browser CDP is parked after timeouts. No enrollment or pairing change authorized/performed.
- Preserve existing F5NM party, isolated JA4 party/guest/queue evidence, Docker volume/data, enrollment/controller/Lounge/catalog/matcher state, all local fixtures/screenshots. No deletion/cleanup, catalog edit, paid lookup, Lounge re-pairing, production change, or unrelated config action authorized. Approved staged deployment and guest/reorder/playback scope remains applicable; newly discovered enrollment/data changes would need exact approval.
- Preserve all pre-existing dirty workflow/documentation files and untracked skills/actions/runbook. Ten saved workflow hashes verified unchanged. Post-delivery validation updates to this handoff are local and uncommitted.
- Deferred backlog: SmartTube authoritative NowPlaying recovery, guest persisted-request/error reconciliation, physical QR/Chrome Open rehearsal, optional small UI modularity refactor.

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

## Admin Follow-up Delivery — 2026-10-02

- User explicitly approved commit/push/deploy of exactly `src/pages/admin/index.vue` and `context/current-feature.md`. Created signed commit `b9f8b515e393c45ba2efad50eb243a6da970a607` (`feat(admin): allow creating another active party`); signature verification passed, remote main matches. Unrelated workflow/doc edits remain preserved.
- Verified non-preview volume setting remains exact existing `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`, then pinned retained staging app to exact new SHA and queued deployment `t99g8i3zwhemk15gt9uii913`. Deployment completion and live testing remain pending.
- Tester clarified prior QR report: only generic Join text was observed; actual QR was not visible/decoded/tested. No guest join or existing-party mutation occurred. Creation control blocker remains valid.

- Additional deployment `t99g8i3zwhemk15gt9uii913` finished at exact SHA `b9f8b515e393c45ba2efad50eb243a6da970a607`. Public `/tablet`, frontend `/api/health`, and controller `/api/health` return HTTP 200 after frontend startup settled; Coolify reports running/healthy.
- Independent sole UI tester ran one allowlisted exact mount assertion at 01:36:37 America/New_York: `expected_volume_matches=true destination=/pb/pb_data` for the PocketBase container and verified existing hyphen-named volume. All deployment gates satisfied; parent instructed tester to proceed with the already-approved isolated lifecycle tests.

- Normal admin UI successfully created an isolated party (safe suffix JA4), expiry 13:37:13 America/New_York, 0 initial guests. Successful normal creation establishes the constrained `tablet_admin` endpoint requirement. Existing F5NM party remains untouched.
- New party reports controller disconnected; visible Bind available controller returned No current controller is available. No grant, re-enrollment, or Lounge setup was performed. Tester continues catalog-only guest additions and preplayback reorder, and may ordinarily open the installed companion to read sanitized readiness/recover existing persisted connection without clearing data or changing pairing.

- Guest UI successfully requested existing approved Catalog song `18`. Immediate distinct request hit the expected visible rate limit and did not enter the queue; established minimum gap is 30 seconds and is respected before retry. No fallback/paid YouTube operation was invoked.
- Fresh verified Fire identity followed by normal existing MainActivity launch and diagnostic-only scroll showed: controller endpoint `karaoke-test.app.starsummit.net`, phase listen, fresh state reported, no controller error, Lounge CONNECTED, last event noop, no video/player/position. Staging selection/pairing controls were not changed. Historical top-level connected text alone was not treated as authoritative readiness; new party binding/status is refreshed separately.

## Retained Staging Live Evidence — 2026-10-02

- On isolated party suffix JA4, normal guest Catalog requests added `18`, `2 Become 1`, `2 Poor Kids`, and `2002`. One immediate second request hit expected rate limiting and added no row; spaced requests succeeded. No paid/fallback YouTube operation or catalog edit.
- Real deployed `/tablet` before playback: initial order `18 → 2 Become 1 → 2 Poor Kids`; pointer handle drag across two rows moved `18` last and fresh state confirmed `Queue order updated`, `2 Become 1 → 2 Poor Kids → 18`. Up moved `18` second; Down restored third. First Up and last Down were disabled. Subsequent guest addition `2002` appeared fourth; explicit Refresh preserved `2 Become 1 → 2 Poor Kids → 18 → 2002`. This proves live preplayback reconciliation and preservation of a subsequent addition, not a simultaneous race or during/after playback.
- New party's Bind available controller still returned No current controller is available after ordinary companion launch and fresh diagnostic reads. Device diagnostics show staging endpoint, listen, fresh state reported, no error, Lounge CONNECTED, no video/player. No pairing grant, enrollment change, native transport control, or deletion was performed.
- Fire Chrome `/tablet` has no authenticated operator session. Human sign-in to the constrained account was requested without asking for the password; device UI actions are parked while sign-in is pending. Physical/device touch remains untested.
- Playback start, reorder during playback, completion, post-completion reorder remain blocked by controller availability. Read-only bounded grant-ownership/liveness diagnosis is in progress via existing authenticated Coolify host terminal, with count/Boolean projections only; no credential/auth-store export or API helper.

## Controller Availability Runtime Baseline — 2026-10-02

- Read-only Python sqlite3 connection (`mode=ro`) to the verified mounted database returned aggregate tuple `(1, 12, 0)`: exactly one isolated KJA4 party, 12 redeemed grants for that party's owner, and zero `created` columns on `controller_enrollment_grants`. No IDs, raw records, passwords, hashes, tokens, or credentials were selected. A party query using ORDER BY created also failed; the successful aggregate omitted that invalid ordering.
- Existing private `ownedControllerIds` helper sorts grant enumeration by `-created` in both transaction and fallback reads and catches failures as an empty set. This explains the normal UI auto-bind gate despite existing owned grants and connected staging companion. Current consumers: party creation auto-bind, Bind available controller, and ownership fallback. No new public/shared contract is needed; preserve exact operator filtering, deduplication, limits and current generation/session/state guards.
- Full bounded shared/auth behavior pipeline started with a read-only planner; intended minimum production delta is a schema-valid sort on the existing grant query. Actual migration/runtime regression must cover normal constrained grant/redeem/state, new-party auto-bind and explicit available bind, plus established ownership/freshness guards. No migration/schema, API shape, credential/enrollment, or generic abstraction change is intended. Any new commit/push/deploy requires reviewed exact scope approval.
- Human replied ready for Fire browser sign-in. Tester opened `/tablet` and saw sign-in; because auth uses sessionStorage, launching another Chrome tab can lose access to the human-authenticated tab. Tester is checking existing relevant Fire tabs without closing tabs or reading/exporting session material before asking for another sign-in.

## Fire Restore Follow-up — 2026-10-02

- Human replied ready. Existing authenticated Fire admin and tablet tabs both show No active party after normal Refresh; the newly opened ACTION_VIEW tab is unauthenticated. Preserve all tabs and their session material. Visible UI exposes no account identity, so account equality is unverified; do not infer a wrong login or inspect private auth storage.
- Source active-party recovery uses valid `-expires_at` ordering but passes `now()` with an ISO T separator into the database datetime filter. The existing `filterDate` helper documents PocketBase 0.39.7 normalized-date comparison behavior. Planner is evaluating a runtime reproduction before including this existing query in the bounded repair.
- Unchanged pinned controller protocol baseline passes 1/1 on HEAD b9f8b5; it does not exercise successful implicit availability or active-party recovery. Live desktop browser CDP inspection timed out; tester stopped interaction and left Fire state intact.

## Query Repair Implementation Decisions and Minimal Delta — 2026-10-02

- Verified baseline: HEAD b9f8b5, real schema has no grant `created`; current pinned protocol suite passes but lacks positive implicit availability/recovery coverage. Planner traced private helper consumers and existing normal-protocol fixture. Parent settles query ordering as unique schema-valid `id`: enumeration order has no selection meaning because only exactly one live owned controller is selected. Preserve the 10,000 limit, exact ownership comparison, deduplication, transaction fallback and all freshness/revocation guards.
- Minimal production delta: replace both grant `-created` sorts with `id`. Conditionally repair active-party filter parameter to existing `filterDate()` only after an actual runtime regression proves the old comparison fails for a same-day active party. No new public/shared contract: active recovery consumers are existing admin/tablet restore; availability consumers remain creation, implicit bind and ownership fallback.
- Coder owns only `pocketbase/pb_hooks/party_queue.pb.js` and a focused runtime regression under `pocketbase/protocol/`. Independent tester owns subsequent test expansion only. Required sequence: coder RED/GREEN, independent tester, task reviewer and final reviewer. Parent owns integrated evidence and context. No browser, live database, enrollment, credential, remote state or cleanup actions are included in implementation.

- Parent pinned runtime RED probes, using normal constrained operator grant/redeem/device session/state and real migrations: `controller-availability-baseline.cjs` fails expected single fresh owned auto-bound device versus undefined; `controller-restore-baseline.cjs` fails expected same-day owned active party versus undefined. Both retained under `/tmp/starsummit-reorder-tools-20261001/`, no fixture cleanup. This establishes the conditional recovery repair gate. Settled source changes: `+id` in both grant reads; active route parameter `now: filterDate()` using the existing exported helper. Coder edits production only; independent tester owns committed regressions.

## Query Repair Validation and Approval Scope — 2026-10-02

- Production delta remains four changed lines: both owned-grant sort arguments use `+id`, and active-party recovery resolves and calls the existing canonical `filterDate` helper. No authorization, liveness, schema, pairing or API contract change.
- Parent baseline probes RED on HEAD and GREEN on working hook for both single owned fresh auto-binding and same-day party recovery. Independent tester expanded the existing controller protocol fixture and updated its existing reload-safe helper assertion; no new runtime framework or fixture file. Four-file focused run passes 21/21 on PocketBase 0.39.7, including target-row playback lifecycle, single auto-bind, implicit bind, two-live ambiguity, owner denial, stale/revoked/session generation, and latest owned unexpired party recovery.
- Tester initial retained HEAD copy contained only the party hook, so its early enrollment 404 was not counted as RED. Parent verified that hook matches HEAD, added the missing controller protocol hook without deleting anything, and reran: regression now fails specifically at null recovered party. Retained fixtures and probes remain intact.
- Task review passes with no blocking findings; existing 10,000-grant enumeration cap is preserved. Final integrated review passes with no blocking findings; local repair is ready for exact approval, while Fire account equality, restored visibility, touch gestures and live playback remain unverified. `node --check` and scoped `git diff --check` pass. Ten preserved workflow hashes still match.
- Fresh allowlisted Coolify read confirms retained app healthy on b9f8b5; authenticated in-memory environment read confirms exactly one non-preview volume setting and Boolean match to the verified hyphen-named retained volume. No remote mutation occurred for this repair.
- Concrete next approval scope: commit exactly `pocketbase/pb_hooks/party_queue.pb.js`, `pocketbase/protocol/controller_protocol.integration.node.cjs`, `pocketbase/protocol/party_queue.node.cjs`, and `context/current-feature.md`; push main to existing origin; pin resulting exact signed product SHA and deploy only retained staging app `wyxit9qifbwgskjrwibxb330`, preserving `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`. Resume already approved isolated party touch/playback validation afterward. No deletion or enrollment/credential/Lounge/catalog/config change beyond the exact SHA pin.

## Approved Query Repair Closeout — 2026-10-15

- User approved the exact four-file commit, main push and resulting-SHA deployment to retained staging app. Fresh local and remote main remain b9f8b515 before commit; reviewed source delta is unchanged.
- Earlier temporary binary/manifests are no longer present after the time gap. Fresh pinned PocketBase 0.39.7 binary restored from its official release into a new retained temporary directory; focused four-file protocol run passes 21/21 on October 15. A new preservation manifest was captured for the unrelated workflow files before mutations; historical manifest equality cannot be rechecked because the old manifest is absent.
- Fresh allowlisted Coolify inspection: app healthy on b9f8b515. In-memory authenticated environment read confirms the unique non-preview volume setting still matches `xbqbuq8gvckl7r2hgi6yabws-pocketbase-data`. No volume configuration change is needed.
- Commit/push/deploy now authorized; actual resulting SHA and deployment evidence will be recorded after completion. October 2 isolated party has expired by TTL; real-device access and fresh isolated validation must be re-established without deleting or changing prior data.
