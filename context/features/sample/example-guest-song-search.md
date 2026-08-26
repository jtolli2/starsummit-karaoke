# Feature: Guest Song Search

> Example planning specification that demonstrates the expected feature-context format; it is not an instruction to begin implementation.

## Goals

- Let a guest search the locally available song library by title or artist.
- Rank close matches so common typos remain useful.
- Show a limited empty-state path for a future server-side fallback search without exposing a YouTube API key.
- Keep search results separate from queue mutation and tablet playback controls.

## Implementation Decisions

- Verified baseline: reuse the existing approved local song catalog and client-side Fuse.js fuzzy-search approach documented in the architecture overview.
- Keep local search feature-local; the single guest consumer does not justify a new public or shared contract.
- Keep search read-only and separate from queue mutation and playback controls.
- The future PocketBase fallback endpoint, authorization model, and quota contract remain unresolved and are outside this example's implementation delta.

## Minimal Delta

- Baseline: approved local catalog plus client-side Fuse.js search, consumed by the guest party route.
- Smallest expected change: compose the local title/artist search and its typo-tolerant empty state within that guest route.
- Public/shared contract inventory: none for the local path; no new props, emits, composables, stores, types, endpoints, or realtime subscriptions.
- Current consumer: the guest party route (`/party/:code`).
- Out of scope: a new PocketBase endpoint, collection, or migration; queue mutation; tablet playback; and Android companion changes.

## Notes

- This is an example planning spec, not an instruction to implement the feature.
- Use Fuse.js for the initial local-search behavior.
- Define the PocketBase fallback endpoint and authorization model before implementing live search.

## Acceptance Checks

- A misspelled title produces useful local matches.
- No browser bundle, request, or test fixture contains a real API key.
- A guest cannot change playback state from the search interface.
