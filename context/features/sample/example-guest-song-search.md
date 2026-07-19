# Feature: Guest Song Search

> Example planning specification that demonstrates the expected feature-context format; it is not an instruction to begin implementation.

## Goals

- Let a guest search the locally available song library by title or artist.
- Rank close matches so common typos remain useful.
- Show a limited empty-state path for a future server-side fallback search without exposing a YouTube API key.
- Keep search results separate from queue mutation and tablet playback controls.

## Notes

- This is an example planning spec, not an instruction to implement the feature.
- Use Fuse.js for the initial local-search behavior.
- Define the PocketBase fallback endpoint and authorization model before implementing live search.

## Acceptance Checks

- A misspelled title produces useful local matches.
- No browser bundle, request, or test fixture contains a real API key.
- A guest cannot change playback state from the search interface.
