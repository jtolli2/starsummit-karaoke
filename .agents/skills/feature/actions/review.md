# Review Action

1. Read `context/current-feature.md` when reviewing a feature, including its recorded verified
   baseline, `Minimal Delta`, and `Implementation Decisions`. Inspect the reviewed revision or final
   working-tree/index diff and untracked files; report missing or unverifiable evidence as a specific
   review gap rather than inventing it.
2. For a feature review, assess every goal against the final diff. For a focused follow-up, review
   the assigned scope and affected behavior. Identify missing behavior, bugs, scope creep, and
   maintainability concerns; keep unrelated edits out of the verdict.
3. Inventory each new public or shared Vue, PocketBase, and Android contract (including Vue
   props/emits, route consumers, composables, stores, shared TypeScript types, PocketBase endpoints,
   collections, schema/migrations, rules, auth roles, realtime subscriptions, Android services, IPC,
   process-restart/lifecycle behavior, and Keystore/persisted-state boundaries). For each, name its
   current consumers and confirm it is required by a goal, runtime behavior, backend contract, or
   established repository convention. Skip the product contract inventory when the reviewed change
   does not affect product behavior or a shared contract.
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
6. Verify that independent tests and applicable runtime/build evidence cover the changed behavior
   in the reviewed revision or working-tree diff. Treat self-authored implementation-aware checks
   as supporting evidence only. Reuse current evidence; when inputs changed, request only the checks
   needed to cover affected claims. A newer revision alone does not stale unrelated evidence.
7. For a small, low-risk follow-up, provide one independent review. Use broader re-review when
   corrections change contracts, authorization, shared behavior, or substantial integration.
8. Give a verdict: ready to complete, ready with noted follow-ups, or needs changes. List any
   unresolved contract, scope, security, runtime, or evidence risk explicitly.
