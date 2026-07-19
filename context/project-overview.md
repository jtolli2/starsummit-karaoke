# Starsummit Karaoke Project Overview

> Compact reference for the product model, intended architecture, and open decisions. Read [overview.md](overview.md) for the canonical rough draft and detailed rationale.

## Product

Starsummit Karaoke is a private multi-user karaoke system for parties. Guests use their phones to search for and queue tracks. A shared tablet displays a QR code and acts as the party's central control hub. SmartTube on a Fire TV Stick plays the selected YouTube video without ads.

## Intended Architecture

PocketBase, hosted on a Hetzner VPS, is the shared backend and static host. It is expected to provide SQLite-backed `karaoke_queue` and `song_library` collections, real-time subscriptions, and a protected proxy for the YouTube Data API. The Vue app must not contain the YouTube API key.

The guest client searches a cached song library with Fuse.js and may request a limited fallback search through PocketBase. It appends requests to the shared queue. The tablet owns playback transitions and relays approved commands over the local network to SmartTube through the YouTube Lounge protocol. SmartTube is a playback receiver, not a guest-search API.

## Open Decisions

- Define and validate the tablet-to-SmartTube pairing and command protocol.
- Decide when the song library is large enough to move from client-side fuzzy search to server-side SQLite FTS5.
- Choose queue fairness rules and concurrency semantics for simultaneous guest requests.

Read [overview.md](overview.md) for the full rough draft, rationale, and anticipated failure modes.
