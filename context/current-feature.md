# Controller Pairing Reliability and Recovery

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Establish phase-by-phase evidence for constrained enrollment-grant creation, Android easy-open
  delivery, manual short-code resolution, one-time redemption, Keystore-backed controller credential
  persistence, session recovery, fresh state reporting, and authoritative `/admin` connected status.
- Make QR/deep-link and manual entry use one server-issued, expiring, operator-scoped grant with a
  simple companion pairing screen, explicit success/failure phases, and safe retry behavior.
- Recover without APK reinstall by discarding only definitively invalid local controller enrollment
  state while preserving Lounge `PairingStore` data and all unrelated app/server state.
- Preserve one-time hashed grants, replay resistance, origin binding, constrained `tablet_admin`
  creation/status access, Android-only durable controller secrets, and PocketBase authority.
- Add pinned PocketBase 0.39.7, Android JVM/process-restart, and Vue phase/error/retry coverage; run
  full backend, Android, Vue, build, syntax, secret, and independent review checks.
- Deliver signed commits to existing `main`, deploy the exact product SHA to retained Compose staging
  app `wyxit9qifbwgskjrwibxb330` without replacing its PocketBase volume, install the exact APK on
  the retained Fire tablet, and prove connected status after relaunch.

## Constraints and Notes

- Standing approval covers fix-scoped local edits/tests, signed commits and pushes to `main`, retained
  staging mutations, grant lifecycle operations, Android build/install/launch, ADB diagnostics,
  constrained browser actions, and Fire-tablet pair/re-pair actions for this task.
- Do not delete records/resources, replace the PocketBase volume, change production DNS/cutover,
  interrupt Wi-Fi, perform unrelated catalog/party/queue/matcher/YouTube operations, issue SmartTube
  playback commands, or re-pair Lounge unless strictly required. Preserve Lounge `PairingStore`.
- Never expose enrollment secrets, controller credentials/tokens, Lounge material, Google cookies,
  API keys, rendered Coolify environment values, or a PocketBase superuser session in Vue/browser.
- 2026-08-11: Synchronized clean `main` at signed SHA `f33950e`; `origin/main` was already current.
  Loaded the repository feature workflow and began with read-only architecture and live-environment
  evidence before implementation.
- Root cause evidence isolated enrollment from controller startup: both grant redemption paths
  worked, but replacing credentials retained the previous device's session/progress generation.
  The newly enrolled device authenticated and created generation 1, then the bridge rejected that
  generation against stale local progress and never reported authoritative state. Grant status also
  inferred connection from session timestamps, so `/admin` could report pairing success while its
  controller card remained disconnected.
- Implemented atomic Keystore-backed controller credential replacement and controller-only recovery,
  generation-safe resume/state reporting, bounded phase/error diagnostics, and definitive-rejection
  handling without touching Lounge storage. The companion now presents one controller-first pairing
  surface for the same one-time grant's QR/deep link and normalized manual code.
- PocketBase now binds the hashed one-time grant to its operator and public origin, distinguishes
  expiry/replay/revocation/wrong-origin failures, and reports connected only for an unrevoked device
  with a current session plus a fresh matching-generation connected state. The frontend preserves
  the same grant's fallbacks until authoritative redemption, serializes status refreshes, and binds
  the exact redeemed device before showing success.
- Signed product commit `fbb9c75346c6c81867588d6d2e931bfaf41b8450` is pushed to `main` and
  deployed as finished Coolify deployment `u59xjep0jzvmayvycvoxbgpf`; staging frontend and
  PocketBase health are HTTP 200 and the retained external volume was preserved. The exact installed
  debug APK SHA-256 is `7b382edc7e198b3cb590f65b09ff79ce82089f575f86685dc7ab159944cfb0e7`.
- Verification passed 78 Vue tests and production build, 96 Android JVM tests and debug assembly,
  32 focused controller/backend contracts, PocketBase 0.39.7 integration, hook/migration syntax,
  diff/secret checks, and independent integrated review. The repository-wide backend protocol run
  still has three unrelated pre-existing catalog-contract fixture failures; controller tests pass.
- Live retained staging evidence on 2026-10-01 used isolated party `P93PF5NM`, created through the
  constrained `/admin` surface with zero guests, queue entries, or playback. Two server-issued
  grants were redeemed: first via the normalized lowercase grouped manual code, then via the second
  grant's exact QR/deep-link payload decoded offline and opened with Android `ACTION_VIEW`. The
  companion reported connected with fresh state; `/admin` showed pairing and Controller connected.
  After the manual redemption, force-stop/relaunch and an admin refresh still showed connected more
  than 90 seconds later. After the QR redemption, `/admin` cleared its grant controls and again
  showed pairing and Controller connected.
- The tester's later read-only diagnostic scroll reported Lounge `CONNECTED`, controller phase
  `listen`, staging endpoint, fresh-state connection proof, and no error. No Lounge control was
  activated. `Lounge PairingStore` was preserved across process restarts; the retained preferences
  file still has encrypted `ciphertext`/`iv` entries. Its raw file hash changed during service
  refresh, so hash identity is not evidence of byte-for-byte immutability.
- Final post-QR live gate passed on 2026-10-01 at 20:56:09 UTC, more than 90 seconds after the
  20:54:28 force-stop/relaunch. A root-side authoritative `/admin` Refresh and full accessibility
  tree showed `Controller connected · unknown` and `Pairing status connected · Starsummit tablet`.
  The tester's final read-only diagnostics showed controller phase `listen`, staging endpoint,
  fresh-state proof, no error, and Lounge `CONNECTED`. Safe evidence captures are
  `/tmp/starsummit-pairing-final-admin.png` and `/tmp/karaoke-tablet.XBKSta`.
- A physical camera scan and Chrome's Open button were not exercised. The second grant's QR payload
  was decoded locally/offline and its Android `ACTION_VIEW` resolver path successfully redeemed it;
  this limitation does not change the completed manual and deep-link grant/recovery validation.
- Closeout boundary: product SHA `fbb9c75346c6c81867588d6d2e931bfaf41b8450` is the signed pushed
  and deployed revision; Coolify deployment `u59xjep0jzvmayvycvoxbgpf` finished for that exact SHA,
  staging frontend/API health returned HTTP 200, and the retained PocketBase volume was preserved.
  Pre-closeout local `main` HEAD `fc0b3bcf557f11c33b757acbcf1f95127b852fb2` is a later signed user-guidance commit,
  not the deployed product revision. The installed version `0.1.0` (code `1`) APK SHA-256 is
  `7b382edc7e198b3cb590f65b09ff79ce82089f575f86685dc7ab159944cfb0e7`.
- Live mutations were limited to creation/use of the isolated party and two grants, controller
  credential/device/session records resulting from the two redemptions, approved APK install and
  launch, and the reported force-stop/relaunch checks. Existing records and the external volume
  were retained. No cleanup, Wi-Fi/DNS/cutover, catalog, queue, matcher, YouTube, playback, or Lounge
  pairing/control operation was performed. The prior August party/grant evidence remains historical;
  no unavailable record IDs or counts are inferred.
