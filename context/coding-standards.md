# Coding Standards

> Project-specific implementation, security, and test conventions for application changes.

## Vue and TypeScript

- Use Vue 3 single-file components with `<script setup lang="ts">`.
- Use two spaces, single quotes, no semicolons, LF endings, and a 100-character line width.
- Use PascalCase for components, camelCase for functions and variables, and `@/` imports for `src/` modules.
- Keep components focused; extract reusable state and side effects into composables.
- Use `vite-plugin-pages` and place route components under `src/pages/`; do not maintain a duplicate manual route table.

## Scope and Contracts

- Make the smallest viable delta and preserve behavior already verified by tests or runtime
  evidence. Compose feature-locally when there is one consumer; add a shared or public contract
  only after naming its current consumers and justification.
- Do not add speculative Vue props, emits, pass-through callbacks, composables, stores, shared
  types, PocketBase validators, endpoints, collections, schema or migrations, helpers, or Android
  service, IPC, or lifecycle surfaces. Validate a rule at the boundary that owns it, duplicating
  validation only for distinct contracts or failure modes.

## Data and Security

- Keep secrets, YouTube API calls, and privileged queue mutations in PocketBase.
- Validate external input and authorization server-side.
- Model queue state transitions to handle concurrent guests without dropping or duplicating requests.
- Never authenticate browser code as a PocketBase superuser. Use a constrained application account with the `tablet_admin` role for tablet/admin routes.
- Route guest submissions through `POST /api/karaoke/requests`, validating party access, expiry, identity, duplicates, rate limits, and fair placement atomically. Do not grant direct public write access to queue collections.

## Tests

- Put Vitest tests in `src/__tests__/` as `*.spec.ts` files.
- Test observable behavior and important error cases.
- Protect documented API, security, persistence, and runtime behavior rather than hypothetical
  states or implementation details.
- Run `bun test:unit --run` and `bun run build` before delivery.
