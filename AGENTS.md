# Repository Guidelines

## Project Purpose & Architecture

This project is a private, cloud-backed karaoke system for parties. Guests follow a QR URL containing a party code, then use a phone-friendly Vue app to search, view the active queue, and request songs. A shared tablet acts as the central hub; SmartTube on a Fire TV Stick plays the selected YouTube video. Treat [context/overview.md](context/overview.md) as the architectural brief and update it when an approved decision changes.

The app uses separate frontend and PocketBase containers in one repository, initially managed by Coolify at `karaoke.app.starsummit.net`; Coolify routes `/api` and realtime traffic to PocketBase. A future external deployment should use managed Compose with Traefik. PocketBase owns persistent data, realtime state, validated queue-request endpoints, and the server-side YouTube proxy; the frontend container serves Vue assets. Never expose API keys or PocketBase superuser credentials to clients. The tablet signs in as a constrained application user with the `tablet_admin` role.

## Project Structure & Module Organization

This Vue 3, Vite, and TypeScript application starts at `src/main.ts`; `src/App.vue` is the root component. Use `vite-plugin-pages` for file-based routing under `src/pages/` (for example, `party/[code].vue`, `admin/index.vue`, and `tablet/index.vue`). The empty router is initial scaffolding until those pages are implemented. Add components, composables, and services under `src/`; place tests in `src/__tests__/` and public assets in `public/`. Keep PocketBase code in `pocketbase/`, including `pb_hooks/`, `pb_migrations/`, and its container definition.

## Build, Test, and Development Commands

Use Bun (`bun.lock` is committed):

- `bun install` installs dependencies.
- `bun dev` starts Vite with hot reload.
- `bun run build` type-checks with `vue-tsc` and produces `dist/`.
- `bun test:unit --run` runs the Vitest suite once.
- `bun lint` applies Oxlint and ESLint fixes; inspect its diff afterward.
- `bun format` formats `src/` with Prettier.

## Coding & Testing Standards

Use TypeScript and Vue single-file components with two-space indentation, LF endings, no semicolons, single quotes, and a 100-character width. Use `<script setup lang="ts">`, PascalCase component names (`QueuePanel.vue`), camelCase variables, and the `@/` alias for `src/` imports. Write behavior-focused Vitest tests as `*.spec.ts` in `src/__tests__/`; cover changed logic and regressions. No coverage threshold is configured.

## Feature Workflow & Delivery

Use the project-local feature workflow at `.agents/skills/feature/` and its `context/` files to load, implement, test, review, and explain scoped work. Keep commits short and imperative, matching the existing history. Pull requests should describe user-visible behavior, tests run, relevant issue links, and screenshots for UI changes. Obtain explicit approval before committing, pushing, merging, or deleting a branch.
