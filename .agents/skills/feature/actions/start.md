# Start Action

1. Read `context/current-feature.md` and verify that Goals are populated. Otherwise instruct the user to run `feature load` first.
2. Set its status to `In Progress`.
3. Before editing production code, complete the baseline/contract/minimal-delta checkpoint:
   - Inspect the existing implementation, tests, and available runtime evidence; compare the
     requested behavior with the verified baseline, then record the baseline and current consumers
     in `Implementation Decisions` and `Minimal Delta`.
   - Inventory affected contracts: Vue component props/emits and route consumers; composables,
     stores, and shared types; PocketBase endpoints, hooks, collections, schema/rules, migrations,
     auth roles, and realtime subscriptions; and Android companion services, IPC/intents,
     lifecycle/process-restart behavior, and Keystore/persisted-state boundaries.
   - Justify each proposed public/shared contract against a current consumer and an active goal.
     Preserve behavior that already satisfies the request and record the smallest expected delta plus
     explicit out-of-scope behavior. Do not add speculative abstractions, validation, compatibility,
     or tests.
4. If an unresolved choice would materially change behavior or architecture, stop and ask the user
   before production edits. Keep non-material unknowns explicit in the working record and resolve
   them with evidence as work proceeds.
5. If a dedicated branch is wanted, create `codex/feature/<short-slug>` (or
   `codex/fix/<short-slug>`). Do not assume a branch is required when the user has not requested one.
6. Implement the goals in order. Use file-based routes under `src/pages/`; keep Vue client
   responsibilities separate from PocketBase secrets, validated queue-request logic, and tablet-only
   playback coordination.
7. Keep `context/current-feature.md` current: update status, decisions, minimal delta, deferred work,
   and verification evidence as they become known.
