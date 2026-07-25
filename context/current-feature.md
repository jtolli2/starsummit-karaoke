# One-Tap Controller Enrollment and Pairing Wizard

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Add a protected `/admin` Pair controller flow that creates a five-minute, single-use,
  operator-scoped enrollment grant with opaque one-time material only.
- Add forward-only PocketBase persistence and authenticated endpoints that redeem grants exactly
  once, issue controller credentials only to the enrolled companion, preserve monotonic controller
  generations, and publish sanitized authoritative status.
- Add a package-targeted Android deep-link path plus short-code/manual fallback. The companion must
  show and validate its expected server hostname and device identity before redemption, persist
  issued credentials only through Android Keystore-backed storage, and never log them.
- Make the admin UI wait for authoritative heartbeat/session state and clearly report connected,
  expired, revoked, replayed, wrong-server, unavailable, and recoverable retry states. Keep Lounge
  TV-code pairing as a distinct optional second step.
- Cover grant expiry, replay/race/concurrency, authorization, revocation, restart recovery,
  invalid links, and touch-first accessibility. Validate the affected Vue, PocketBase 0.39.7, and
  Android surfaces, then independently review the finished implementation.

## Constraints and Notes

- Preserve the constrained `tablet_admin` boundary, separate Lounge material, SSE wake plus
  authoritative HTTPS refetch, and idempotent controller-command contracts. Do not expose
  controller credentials in Vue, PocketBase records, diagnostics, or logs.
- Baseline gate passed: HEAD `eaf4505b10173748edb2010dec77afdae12c2fbc` contains the required
  PocketBase 0.39.7 MusicBrainz cron-wake repair. Keep the matcher hooks and `mb-majority-v2`
  policy unchanged.
- Before every staging deployment, record durable job `sqwd85vrfrwrzym` status, cursor, totals,
  and updated_at. Retain the external PocketBase volume and all matching records. A backend
  deployment must prove the same job resumes at or beyond its prior cursor and advances on cron.
- Standing approval covers feature-scoped commits/pushes, retained staging mutations/deployments,
  and non-disruptive Fire-tablet build/install/launch/enrollment validation. It excludes deletion,
  volume replacement, DNS/cutover, Wi-Fi interruption testing, unrelated catalog/party/queue work,
  and credential exposure.

## Implementation Notes

- 2026-07-25: Loaded and started from the delegated request. Local worktree was clean at the
  required baseline. Remote inspection, implementation, and runtime deployment evidence pending.
- 2026-07-25: Implemented an additive, tablet-admin-scoped enrollment wizard: five-minute
  hash-only grants plus separately hashed manual short codes, transactional redemption/revocation,
  strict host/destination binding, a heartbeat-authoritative sanitized status route, and a
  companion confirmation step before credentials are issued. The browser keeps raw deep-link
  material out of rendered markup and clears its in-memory copy after launch; controller and
  Lounge Keystore stores remain distinct.
- 2026-07-25: Local evidence passed: controller protocol contracts 9/9, pinned PocketBase 0.39.7
  integration 1/1, focused admin tests 13/13, Vue production build, and Android debug unit tests
  plus APK assembly. Independent review approved after adversarial replay/revoke/deep-link checks.
- 2026-07-25: Retained staging deployment `rs48m6eyxs8h7ab197mih43z` imported
  `1cc4d2a9a3d8928be8ab43a309a6d700546901c6` with PocketBase 0.39.7 and the existing external
  volume unchanged. The durable `sqwd85vrfrwrzym` matcher was recorded pre-deploy as pending
  at 640/1024 (2026-07-25T07:58:05Z) and post-deploy as pending at 700/1024
  (2026-07-25T08:01:05.857Z), proving the same job resumed and advanced on cron.
- 2026-07-25: Installed the final Android debug APK on the retained Fire tablet and redeemed a
  fresh manual fallback grant. Authoritative `/admin` status reported `connected · Starsummit
  tablet` after restart recovery and heartbeat. The Android-only follow-ups retain the retry field
  after a failed attempt and restart the controller loop after storing new Keystore credentials;
  neither mutates the deployed matcher.
