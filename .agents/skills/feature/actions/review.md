# Review Action

1. Read `context/current-feature.md`, including its recorded verified baseline, `Minimal Delta`,
   and `Implementation Decisions`. Inspect the final working-tree/index diff and untracked files
   against that baseline; report a missing or unverifiable baseline or decision record as a review
   gap rather than inventing one.
2. Review every goal against the final diff. Identify completed goals, missing behavior, bugs,
   scope creep, and maintainability concerns. Keep unrelated edits out of the feature verdict.
3. Inventory every new public or shared Vue, PocketBase, and Android contract (including Vue
   props/emits, route consumers, composables, stores, shared TypeScript types, PocketBase endpoints,
   collections, schema/migrations, rules, auth roles, realtime subscriptions, Android services, IPC,
   process-restart/lifecycle behavior, and Keystore/persisted-state boundaries). For each, name its
   current consumers and confirm it is required by a goal, runtime behavior, backend contract, or
   established repository convention.
4. Reject pass-through layers and callback chains, duplicate shared types or mappings, redundant
   validation without a distinct trust boundary, extra persistence or query behavior, speculative
   compatibility, and tests for invented states or implementation details. Prefer feature-local
   composition when there is one consumer; do not accept a new abstraction merely because it is
   reusable in theory.
5. Check karaoke-specific security and runtime boundaries: no client secret, Lounge material, or
   superuser exposure; party-code and temporary-credential validation; guest submissions through
   the server endpoint; safe PocketBase authorization; resilient realtime queue handling; and no
   guest path that can take tablet-only playback control. Preserve required Android Keystore,
   controller-session, origin-binding, and authoritative-state contracts.
6. Verify that independent tests, pinned-runtime evidence, and the production build cover the
   changed behavior and match the final diff. Treat self-authored implementation-aware checks as
   supporting evidence only, and flag stale, missing, or overfit tests.
7. Give a verdict: ready to complete, ready with noted follow-ups, or needs changes. List any
   unresolved contract, scope, security, runtime, or evidence risk explicitly.
