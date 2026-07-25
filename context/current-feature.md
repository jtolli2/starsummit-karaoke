# Catalog Review Retained-State Repair and Approval Integrity

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

 Complete

## Goals

- Add a forward-only, idempotent PocketBase 0.39.7 migration that repairs only blank or invalid
  retained `mb_match_status` values to `not_attempted`, preserving all other catalog and matcher
  evidence and safely handling fresh and upgraded databases.
- Apply one authoritative server-side approvability policy to individual and bulk approval, retain
  transactional rejection/demotion audit and eligibility behavior, and return normalized actionable
  catalog-review errors without internal details.
- Clearly flag invalid approved rows and distinguish identity conflicts from schema/save failures in
  `/admin`; do not expose an approval action the server will reject.
- Add retained-shape, migration-idempotency, parity, collision, malformed-state, authorization,
  rollback, and concurrency regression coverage; validate against pinned PocketBase 0.39.7 and Vue.
- Deploy only after recording matcher-job baseline, preserve the retained volume/job/cache/policy,
  validate the named staging record through constrained `tablet_admin` endpoints, and prove the
  existing matcher resumes or is complete.

## Constraints and Notes

- Preserve the constrained `tablet_admin` boundary and never expose secrets or superuser access.
- Keep the query-marker cron-wake repair, `mb-majority-v2` policy, matcher hooks/job/cache, external
  PocketBase volume, unrelated catalog records, and party/queue/controller/tablet state intact.
- Before deployment record durable job `sqwd85vrfrwrzym` status, cursor, totals, report counts, and
  `updated_at`; after deployment prove it resumes at or beyond that cursor and advances, or is
  authoritatively complete. Never create/restart a matcher job or rewrite matcher output.
- Standing approval covers scoped local edits, commits/pushes to existing `main`, retained staging
  PocketBase/Coolify mutations and deployment, Vue changes, and constrained live catalog validation;
  it excludes deletion, volume replacement, DNS/cutover, Wi-Fi interruption testing, unrelated
  curation, direct browser superuser writes, and destructive cleanup.

## Implementation Notes

- 2026-07-25: Loaded and started from delegated request at current `origin/main`
  `ad4d7f32d9c0c91454eb3c16891bbf0ecce31abc`. Remote baseline and implementation evidence pending.
- 2026-07-25: Added the forward-only `mb_match_status` repair and one shared server approval
  policy across individual, batch, and selection workflows. Pinned PocketBase 0.39.7 migration
  and route integrations pass, along with 57 Vue unit tests, the production build, and independent
  review. Staging deployment `eqqr6glbot3xf4qc1wp8b6tk` imported
  `08a31939aeff95dced4ef417047ded321c852ee3`; `/healthz` and `/api/health` returned 200.
- 2026-07-25: Through the constrained tablet-admin UI, record `gi7jvgyrbml4rg4`
  (`046zCU6C5qY`) was rejected and displayed as ineligible with its review audit transition;
  the canonical owner `IQs4p65sgLQ` remained approved/eligible. A Sam Smith / Like I Can
  correction returned the expected clear identity-conflict response without changing either row.
- 2026-07-25: The external volume was retained and no matcher job was created, restarted, or
  mutated. Historical retained evidence recorded job `sqwd85vrfrwrzym` advancing 640/1024 to
  700/1024 before this feature. The newly added read-only latest-job lookup returned 404 in
  staging, so this feature does not claim fresh post-deploy matcher continuity; this is the
  remaining operational verification risk and requires separate non-mutating diagnosis.
