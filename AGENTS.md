# Repository Guidelines

## Project Purpose & Architecture

This project is a private, cloud-backed karaoke system for parties. Guests use a phone-friendly Vue app to search and append songs; a shared tablet acts as the central hub; SmartTube on a Fire TV Stick plays the selected YouTube video. Treat [context/overview.md](context/overview.md) as the rough-draft architectural brief and update it when an approved architecture decision changes.

The intended backend is PocketBase on a Hetzner VPS. It owns the `karaoke_queue` and `song_library` collections, real-time state, static hosting, and a server-side YouTube Data API proxy. Never expose API keys to clients. Keep phone interactions append-oriented, and reserve playback coordination and queue-state transitions for the tablet hub. The tablet is also the only planned bridge to SmartTube's local YouTube Lounge protocol.

## Project Structure & Module Organization

This Vue 3, Vite, and TypeScript application starts at `src/main.ts`; `src/App.vue` is the root component and `src/router/index.ts` defines routes. Add components, composables, and services under `src/`; place unit tests in `src/__tests__/`; place publicly served assets in `public/`. Tooling configuration lives at the root (`vite.config.ts`, `vitest.config.ts`, `eslint.config.ts`, and `tsconfig*.json`).

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
