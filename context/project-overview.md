# Starsummit Karaoke Project Overview

> Compact reference for the product model, intended architecture, and open decisions. Read [overview.md](overview.md) for the canonical rough draft and detailed rationale.

## Current Hosting Context

The Hetzner server currently runs Coolify at `app.starsummit.net` and hosts other applications. Karaoke will be containerized and initially managed by Coolify at `karaoke.app.starsummit.net`. If it moves outside Coolify later, use an externally managed Docker Compose stack with Traefik; an additional Traefik/Nginx cannot independently claim ports 80/443 while Coolify's ingress uses them.

## Working Product Decisions

Guests enter through a QR URL containing a party code, receive party-scoped temporary identities, can read the sanitized active queue, and submit song requests through a validated server endpoint. Parties expire after 12 hours; duplicate songs are blocked while queued or playing but may be requested again after completion. Fair rotation is preferred. The initial library target is about 5,000 songs. Karaoke backing tracks are strongly preferred; live, misleading, unrelated, and ordinary non-karaoke covers are excluded. A controlled, ineligible `fallback_lyric` or `fallback_audio` may be retained only for operator review and later replacement. Catalog records retain source provenance, confidence, review/replacement history, and eligibility metadata.

The tablet signs in as a constrained application user with the `tablet_admin` role—never as a PocketBase superuser. File-based Vue routes include `/party/:code`, `/admin`, and `/tablet`.

## Product

Starsummit Karaoke is a private multi-user karaoke system for parties. Guests use their phones to search for and queue tracks. A shared tablet displays a QR code and acts as the party's central control hub. SmartTube on a Fire TV Stick plays the selected YouTube video without ads.

## Intended Architecture

PocketBase runs as a separate stateful backend container on the Hetzner VPS. A stateless frontend container serves the Vue application. Coolify routes same-origin `/api` and realtime traffic to PocketBase, which provides SQLite-backed party, queue, and library data plus the protected YouTube API proxy. The Vue app must not contain API keys or PocketBase superuser credentials.

The guest client searches a cached song library with Fuse.js and may request a fallback search through PocketBase. Queue submissions go through a server-side endpoint that validates the party code, expiry, temporary identity, payload, duplicates, rate, and fair placement atomically.

The Fire tablet uses two cooperating surfaces: the Vue `/tablet` route provides the party display
and constrained `tablet_admin` controls, while a small native Android companion owns the durable
controller connection. The companion receives only approved playback commands from PocketBase and
relays them to SmartTube through YouTube Lounge. Lounge pairing credentials and privileged playback
controls never enter browser clients.

## Open Decisions

- Validate the implemented controller protocol end-to-end against a deployed PocketBase instance
  and updated Fire tablet APK only after separate approval; keep Lounge credentials and direct
  Lounge capabilities device-only.
- Verify Coolify same-origin `/api` routing for `karaoke.app.starsummit.net`, TLS, and PocketBase
  realtime Server-Sent Events (SSE).
- Define persistent storage, backup, secret, TLS/DNS, and resource-limit policies before deployment.
- Define fair-rotation behavior and queue transition recovery.
- Choose the initial library import source and YouTube result-quality rules.
- Set schema-migration procedures and backup retention.
- Decide when the song library is large enough to move from client-side fuzzy search to server-side SQLite FTS5.

Read [overview.md](overview.md) for the full rough draft, rationale, and anticipated failure modes.
