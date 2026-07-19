# Coding Standards

> Project-specific implementation, security, and test conventions for application changes.

## Vue and TypeScript

- Use Vue 3 single-file components with `<script setup lang="ts">`.
- Use two spaces, single quotes, no semicolons, LF endings, and a 100-character line width.
- Use PascalCase for components, camelCase for functions and variables, and `@/` imports for `src/` modules.
- Keep components focused; extract reusable state and side effects into composables.

## Data and Security

- Keep secrets, YouTube API calls, and privileged queue mutations in PocketBase.
- Validate external input and authorization server-side.
- Model queue state transitions to handle concurrent guests without dropping or duplicating requests.

## Tests

- Put Vitest tests in `src/__tests__/` as `*.spec.ts` files.
- Test observable behavior and important error cases.
- Run `bun test:unit --run` and `bun run build` before delivery.
