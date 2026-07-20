# Start Action

1. Read `context/current-feature.md` and verify that Goals are populated. Otherwise instruct the user to run `feature load` first.
2. Set its status to `In Progress`.
3. Inspect the existing code and list the goals, likely files, and risks before editing.
4. If a dedicated branch is wanted, create `codex/feature/<short-slug>` (or `codex/fix/<short-slug>`). Do not assume a branch is required when the user has not requested one.
5. Implement the goals in order. Use file-based routes under `src/pages/`; keep Vue client responsibilities separate from PocketBase secrets, validated queue-request logic, and tablet-only playback coordination.
6. Update Notes with material decisions, deferred work, and verification evidence.
