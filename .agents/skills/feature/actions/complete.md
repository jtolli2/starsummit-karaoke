# Complete Action

1. Establish implementation readiness before closeout: confirm that the final in-scope diff was
   reviewed against its verified baseline and recorded `Minimal Delta`/`Implementation Decisions`,
   applicable checks are current for that diff, and no blocking implementation findings remain.
   Keep the decision, minimal delta, and active feature record current. Separate this readiness from
   completion of the user's full goal and any live operational validation.
2. Manual end-to-end checks requiring the user (for example, direct TV observation) are
   non-blocking follow-up notes unless the user explicitly makes them a release/completion gate.
   Record their unverified status and requested observations without holding completion open.
   If other user goals or required agent-executable live validation remain, prepare the closeout handoff with the pending
   work and leave the feature status incomplete. Do not present implementation readiness as full
   goal completion.
3. When all active goals are actually met, update `context/current-feature.md`: set status to
   `Complete` and retain the goals and notes as
   the completion record. Only during this complete action, after the work and validation are done,
   ensure exactly one concise dated entry exists for the feature in `context/feature-history.md`.
   On a rerun, first find that feature's existing entry; update it only when it is the not-yet-
   delivered/refined record, and never append a duplicate completion entry.
4. History entries record important delivered behavior and validation only; keep small
   implementation details in `context/current-feature.md`. If a same-feature entry was drafted or
   refined before delivery, update that existing entry in place rather than appending a correction.
   Append genuinely new entries at the bottom in chronological completion order. Never delete or
   rewrite prior completed entries without explicit history-cleanup approval, and preserve the union
   of meaningful entries when merging.
5. Prepare the implementation closeout handoff even when operational work remains. Use
   `.agents/skills/closeout/SKILL.md` and include repository, branch, HEAD and PR when applicable;
   delivered scope and decisions; validation, limitations, and findings; pending goals and next
   actions with approval boundaries; and local files or data to preserve. Keep pending work explicit;
   do not treat an unmet required goal or unresolved blocker as complete.
6. Before any commit, merge, push, deployment, or branch deletion, verify that current explicit
   approval covers the exact target and expected effect. Request approval only when it is absent or
   unclear.
7. After approval, perform only the approved actions. If merging is approved, use the repository's
   default branch; if deleting a branch is approved, identify its exact local or remote name first.
8. Lead the final response with an explicit status: complete, or incomplete with the concrete
   blocker and next action. Separate non-blocking manual checks from work still owed by the agent.
   Report the resulting commit, branch, validation status, changed files, and any remaining
   uncertainty. Never reset the working file or delete a branch by default.
