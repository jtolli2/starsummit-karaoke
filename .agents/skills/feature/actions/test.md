# Test Action

1. Read the active goals and inspect the feature diff.
2. Add or update `*.spec.ts` tests in `src/__tests__/` for behavior with meaningful logic, including error or race-condition cases where relevant. Do not add superficial tests solely for coverage.
3. Run `bun test:unit --run` and `bun run build`.
4. Optionally run non-mutating quality checks: `bunx oxlint .`, `bunx eslint .`, and `bunx prettier --check src/`.
5. Report the commands run, their results, and untested risks. Do not claim coverage when no coverage report was produced.
