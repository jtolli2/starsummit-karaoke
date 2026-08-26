# Load Action

1. Read the project context files and inspect the request. Do not edit
   `context/feature-history.md` or any other history file during load.
2. Interpret the text after `load`:
   - For a single filename, read `context/features/<name>.md` first, then `context/fixes/<name>.md` if it exists.
   - For prose, derive a concise feature name, goals, and notes without adding assumptions.
   - If no argument is supplied, ask for a spec filename or description.
3. Update `context/current-feature.md` with an H1 feature name, status `Not Started`, measurable
   goals, and relevant constraints or open questions. Preserve existing context that remains
   relevant; this is the active working record, not an archive.
4. Initialize (or preserve) these sections in `context/current-feature.md`:
   - `## Implementation Decisions`: list evidence-backed decisions only. Seed unavailable evidence
     as `Unknown` with the exact question or evidence needed; do not turn unknowns into assumptions.
   - `## Minimal Delta`: state the verified baseline, the smallest expected change, affected current
     consumers/contracts, and explicit out-of-scope behavior. If the baseline or consumer is not yet
     known, record it as `Unknown` for the start checkpoint to resolve.
5. Confirm the loaded scope, including the architectural boundary it affects. Mention the relevant
   Vue props/emits or composables/stores/shared types, PocketBase endpoint/collection/schema/migration
   surface, and Android service/IPC/lifecycle/Keystore surface when applicable; leave inapplicable
   surfaces explicitly marked as such.

Do not edit `context/feature-history.md` during load; it is the append-only record of completed work.
