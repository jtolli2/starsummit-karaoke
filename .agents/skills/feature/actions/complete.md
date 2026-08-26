# Complete Action

1. Confirm that the active goals are actually met, the final diff has passed review against its
   verified baseline and recorded `Minimal Delta`/`Implementation Decisions`, and test/build/runtime
   results are current. Do not mark incomplete evidence as complete.
2. Update `context/current-feature.md`: set status to `Complete` and retain the goals and notes as
   the completion record. Only during this complete action, after the work and validation are done,
   ensure exactly one concise dated entry exists for the feature in `context/feature-history.md`.
   On a rerun, first find that feature's existing entry; update it only when it is the not-yet-
   delivered/refined record, and never append a duplicate completion entry.
3. History entries record important delivered behavior and validation only; keep small
   implementation details in `context/current-feature.md`. If a same-feature entry was drafted or
   refined before delivery, update that existing entry in place rather than appending a correction.
   Append genuinely new entries at the bottom in chronological completion order. Never delete or
   rewrite prior completed entries without explicit history-cleanup approval, and preserve the union
   of meaningful entries when merging.
4. Before any commit, merge, push, deployment, or branch deletion, state the exact target and
   expected effect and obtain explicit user approval.
5. After approval, perform only the approved actions. If merging is approved, use the repository's
   default branch; if deleting a branch is approved, identify its exact local or remote name first.
6. Report the resulting commit, branch, validation status, changed files, and any remaining
   uncertainty. Never reset the working file or delete a branch by default.
