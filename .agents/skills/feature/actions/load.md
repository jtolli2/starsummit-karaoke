# Load Action

1. Read the project context files and inspect the request.
2. Interpret the text after `load`:
   - For a single filename, read `context/features/<name>.md` first, then `context/fixes/<name>.md` if it exists.
   - For prose, derive a concise feature name, goals, and notes without adding assumptions.
   - If no argument is supplied, ask for a spec filename or description.
3. Update `context/current-feature.md` with an H1 feature name, status `Not Started`, measurable goals, and relevant constraints or open questions.
4. Confirm the loaded scope, including the architectural boundary it affects.

Do not edit `context/feature-history.md` during load; it is the append-only record of completed work.
