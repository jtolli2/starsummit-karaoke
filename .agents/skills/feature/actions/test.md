# Test Action

1. Read the active goals and inspect the feature diff. Identify the changed behavior and the checks
   needed to verify it; do not run unrelated product validation for documentation-only or configuration-only
   follow-ups.
2. Add or update `*.spec.ts` tests in `src/__tests__/` only when product behavior with meaningful
   logic requires coverage, including relevant error or race-condition cases. Do not add superficial
   tests solely for coverage.
3. For product changes, use `bun test:unit --run` with the relevant selectors and `bun run build`
   when the changed behavior or active goals require them. Also run backend, Android, and pinned
   PocketBase checks when their behavior is affected or the active goals require them. Preserve the
   substantial validation requirements stated in the active feature goals.
4. Optionally run non-mutating quality checks: `bunx oxlint .`, `bunx eslint .`, and `bunx prettier --check src/`.
5. Report commands and selectors run, results, affected behavior, and untested risks. Do not claim
   coverage when no coverage report was produced. Run focused checks while editing; after shared
   source, tests, dependencies, configuration, and runtime inputs settle, the parent names one owner
   for integrated validation and the full relevant checks. Attribute evidence to a source/test diff
   fingerprint or revision, selectors, runtime, and results. Reuse it while relevant inputs remain
   unchanged; rerun when one changes, not for unrelated documentation or HEAD movement alone.
   Preserve pinned-runtime checks required by the behavior.
6. For delegated live browser/tablet validation, follow [the independent validation runbook](../../../../context/validation-runbook.md); a read-only preflight or historical approval does not authorize remote mutations.

When useful, wrap an already-required authorized command with the repository-local
[closeout `capture-run`](../../../../tools/closeout/README.md). Declare only relevant source, test,
dependency, and configuration inputs, plus the runtime and executable versions; exclude generated
outputs from scope. It discards raw stdout/stderr, so retain separate sanitized diagnostic evidence
or failure counts when needed. `manifest --compare-run` reuse requires `reuse.reusable`; a verified
snapshot alone is not test proof, and imported logs do not prove execution. Documentation-only HEAD
movement may remain reusable when scoped inputs match. Stop owned edits before integrated capture and
tell its owner about later relevant changes. This guidance adds no automatic suite reruns or approval
requirements.
