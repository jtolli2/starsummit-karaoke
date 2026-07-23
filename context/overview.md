# Starsummit Karaoke Architecture Rough Draft

> Canonical, evolving architectural brief for the cloud-backed remote karaoke system. Use it to inform implementation and record approved decisions here when the architecture changes.

## 1. System Vision & User Experience

## The system is a private, multi-user karaoke platform designed for personal parties. Guests use their own mobile devices to seamlessly search for, queue, and manage karaoke tracks via a shared tablet interface. The videos play entirely ad-free on a Fire TV Stick, maximizing audio/video quality without technical maintenance overhead.

## 2. Core Components & Responsibilities

┌──────────────────────────────────────────────────────────┐
│ Hetzner Cloud Server │
│ ┌────────────────────────────────────────────────────┐ │
│ │ PocketBase │ │
│ │ • Database (SQLite + FTS5 Caching) │ │
│ │ • Real-time SSE Subscriptions │ │
│ │ • Static Web Hosting (Vue App Assets) │ │
│ │ • Secure Proxy to YouTube Data API v3 │ │
│ └──────────────────────────▲─────────────────────────┘ │
└─────────────────────────────┼────────────────────────────┘
│ HTTPS / Server-Sent Events
│
┌───────────────────────┼───────────────────────┐
│ Local Home Network │ │
▼ ▼ ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ Guest Phones │ │ Central Hub │ │ Media Node │
│ (index.vue) │ │ (tablet.vue) │ │ (SmartTube) │
│ │ │ │ │ │
│ • Typo-safe │ │ • Sync Brain │ Local │ • Decodes audio│
│ Fuzzy Srch │ │ • Wake-Locked│ WiFi │ • Skips intros │
│ • Queue Appends │ • Proxy Node ├──────►│ • 100% Ad-Free │
└──────────────┘ └──────────────┘ └────────────────┘

## A. The Cloud Backend (Hetzner VPS)

-   Technology: PocketBase (Single-binary Go/SQLite setup) secured via HTTPS (https://yourdomain.com).
-   API Service: Runs in its own stateful container. A separate stateless frontend container serves the compiled Vue application.
-   Database Layer: Manages two core collections: karaoke_queue (active party state) and song_library (prepopulated tracks + cached results).
-   API Shield: Acts as an intermediary middleware; it stores the secret YouTube API key and proxies search requests to prevent exposing credentials to client devices.

## Hosting Constraint (Current State)

- The Hetzner server currently runs a Coolify instance at `app.starsummit.net` and hosts other applications.
- The karaoke app will be containerized and Coolify will manage it for the initial deployment at `karaoke.app.starsummit.net`.
- Prefer the Coolify CLI for supported Coolify inspection and approved mutations. Use the read-only
  Coolify MCP for discovery/verification and direct API calls only when the CLI cannot perform the
  required operation.
- If deployment moves outside Coolify later, use an externally managed Docker Compose stack and Traefik; do not introduce that second ingress during the initial Coolify deployment.
- Coolify's existing ingress likely owns the host's public ports 80/443. An independent Traefik or Nginx cannot bind those ports at the same time; it would need to sit behind Coolify's ingress, or replace/reconfigure ingress for every app on the server.
- Any shared-server design must define resource limits, persistent storage, backups, secret management, TLS/DNS ownership, and a failure boundary so a karaoke deployment cannot disrupt existing apps.

## Current Product Decisions

- Guests scan a QR code containing a party code, currently planned as `https://karaoke.app.starsummit.net/party/<code>`. The code selects and authorizes access to the active party without exposing a predictable public queue.
- Guests receive temporary identities scoped to that party and may read its sanitized active queue and submit song requests. The tablet uses a signed-in application user with the `tablet_admin` role for queue and playback administration; it never uses a PocketBase superuser session.
- Parties expire after 12 hours. Duplicate songs are not allowed in the active queue, and fair rotation is preferred over simple first-in/first-out ordering.
- Party codes expire with the 12-hour party. Store only an appropriate server-side representation of the code and avoid logging or exposing it outside the QR/join flow.
- Guests may read a sanitized active queue and create requests, but cannot update, delete, reorder, or transition queue records. Duplicate prevention applies while a song is queued or playing; a song may be requested again after completion.
- The initial song library target is approximately 5,000 songs. Search results discovered through the YouTube API should be saved into the song library when appropriate, with no arbitrary per-party search cap beyond API availability and sensible abuse protection.
- The initial catalog targets approximately 5,000 useful songs. Verified karaoke backing tracks
  are strongly preferred; live, misleading, unrelated, and ordinary non-karaoke covers are
  excluded. When no suitable karaoke version exists, an operator may retain a clearly classified,
  ineligible `fallback_lyric` or `fallback_audio` candidate for review and later replacement.
  Song records retain source provenance, scoring confidence, review state, and replacement history
  so this policy remains auditable and configurable rather than an irreversible database rule.
- The guest app should explain clearly why a request was rejected. It is not planned as a PWA. The guest and admin experiences may share the hostname; a separate `/tablet` display route remains an option.

## Confirmed Implementation Defaults

- Keep the frontend and PocketBase in one repository, but use separate runtime containers. PocketBase is stateful and persistent; the Vite frontend is stateless. Coolify routes same-origin `/api` and realtime traffic to PocketBase. Separate repositories are not justified yet.
- Give guests read access to a sanitized active queue. Submit requests through a server-side PocketBase endpoint rather than direct public collection creation; deny guest update/delete access and all admin/library mutations. Let only a signed-in `tablet_admin` application user perform state transitions.
- Generate party codes server-side using cryptographically random, human-typeable values; never use sequential codes. Rate-limit code lookup and expire access after 12 hours.
- The custom `POST /api/karaoke/requests` endpoint must validate party access and expiry, temporary identity, song payload, active duplicates, request rate, and fair-rotation placement atomically, returning a clear rejection reason. Direct public queue writes remain disabled.
- Model a party token, expiry, temporary requester identity, queue status, monotonic sequence, and failure reason. Enforce no duplicate active `(party, song)` records server-side.
- Use file-based Vue routing through `vite-plugin-pages`: `/party/:code` for guests, `/admin` for controls/settings, and `/tablet` for a playback-focused display. Share the constrained admin session between the protected routes. The current empty router is scaffolding, not a manual-routing decision.
- Use write-through caching: search the local library first, call YouTube only for misses, normalize and save selected results, and debounce requests. Keep API keys in Coolify secrets and enforce server-side rate limiting even without a hard user-facing cap.
- Coolify provides server-only `YOUTUBE_API_KEY` and `YOUTUBE_API_KEY_BACKUP` values. The primary
  key is the current runtime credential; the backup is retained for manual development use.
  Automated failover is deferred to a separately scoped enhancement. Never expose either value.
- Prototype SmartTube pairing and playback-state detection in a native Fire tablet companion before
  building the full queue UI. Store durable Lounge pairing material with Android Keystore-backed
  encryption, reconnect by refetching current state, and make transitions idempotent. Lounge
  credentials and privileged playback controls must never enter browser clients.
- Prefer weekly PocketBase backups with a short rolling retention plus a manual backup before large imports. Monthly-only backups risk losing curated library changes.
- Version PocketBase schema/rule changes in the repository and validate them during deployment; do not rely only on manual dashboard edits.

## B. The Media Rendering Node (Fire TV Stick)

-   Technology: SmartTube (Open-source Android TV client) running on Fire OS.
-   Responsibility: Natively plays raw, high-bitrate YouTube DASH streams completely ad-free. It uses built-in SponsorBlock integration to auto-skip non-music filler, intros, and channel promos.

## C. The Central Hub & Native Companion (Fire Tablet)

-   Display technology: Vanilla Vue 3 (`src/pages/tablet/index.vue`) for the party QR, queue, and constrained admin surface.
-   Controller technology: A small Kotlin Android application in `companion-android/`, with a foreground service and no Google Play Services dependency.
-   Responsibility: The native companion maintains the durable controller session, receives approved playback commands from PocketBase over HTTPS/realtime, relays them to SmartTube through the YouTube Lounge protocol, and reports connection/playback state back to PocketBase. The Vue display may observe sanitized state but never receives Lounge pairing credentials or privileged playback capabilities.
-   Credential boundary: Store Lounge pairing material using Android Keystore-backed encryption. Do not place it in browser storage, Vue code, logs, diagnostics exports, or PocketBase records.
-   Recovery: Treat Wi-Fi changes, process death, Lounge token refresh, and realtime reconnect as normal lifecycle events. Reconnect with bounded backoff, refetch authoritative state, and apply commands idempotently.
-   Delivery sequence: TV-code pairing, open-video/play/pause/seek, state diagnostics, process
    recovery, and the local PocketBase controller protocol are implemented. Deployment, native
    enrollment, and end-to-end live validation remain approval-gated.

## D. The Guest Interface (Mobile Devices)

-   Technology: Vanilla Vue 3 + Vite using `vite-plugin-pages` routes under `src/pages/`, including `party/[code].vue`.
-   Responsibility: Allows any guest scanning the QR code to access a fast, lightweight search and queuing portal using a temporary identity rather than a permanent account.

---

## 3. Major Architectural Decisions Made

-   Vanilla Vue 3 (Vite) instead of Nuxt: Nuxt's server-side rendering (SSR) was deemed unnecessary overhead for a private web app. Vue compiles to flat assets served by the stateless frontend container while PocketBase runs separately.
-   SmartTube over Custom Android/WebView Wrapper: Offloads the volatile "cat-and-mouse" game of bypassing YouTube ad-block scripts to an open-source community, ensuring playback stability during a party.
-   Internet-Facing Hetzner Server over Local Hosting: Eliminates local network headaches (like iOS blocking HTTP WebSockets, router AP Isolation issues, or configuring reverse proxies). Guests can easily connect on cellular data or separate Wi-Fi networks.
-   Hybrid Database Caching + Client-Side Fuzzy Search (Fuse.js): The application will pre-load thousands of popular songs into a local SQLite database on boot. The mobile app loads this index into memory, applying client-side fuzzy searching via Fuse.js to catch typos without hitting the YouTube API quota.

---

## 4. Open Questions to Answer Before Coding

1. Coolify ingress: Verify `karaoke.app.starsummit.net`, same-origin `/api`, TLS, and PocketBase
   realtime Server-Sent Events (SSE) on a deployed test instance.
2. Native companion bridge: With separate approval, deploy and validate native enrollment,
   approved-command delivery, acknowledgement, sanitized state reporting, bounded SSE
   reconnect/refetch, and a real Wi-Fi interruption on the Fire tablet.
3. Fair rotation: Define the exact rule, such as one pending song per requester before that requester can be served again.
4. Search quality: Select a real popular-song source and provision the server-side YouTube key
   before the first live import; the committed deterministic fixture validates the pipeline only.
5. Operations: Set Coolify resource limits, backup retention, secret rotation, and schema-migration procedures.

---

## 5. Anticipated Implementation Issues to Tackle

-   Android Background Lifecycle: Fire OS may stop or restart the companion despite its foreground
    service. Persist only durable pairing material, rebuild ephemeral Lounge sessions after restart,
    reconnect with bounded backoff, and make the current notification state useful for diagnosis.
-   YouTube API Quota Burn: Despite local caching, if guests bypass the local library to look for obscure songs, a single search returns multiple items. Implementing smart search input debouncing (waiting until typing stops for 500ms) and restricting search results to 5 tracks per query is necessary.
-   Concurrency and State Race Conditions: If the tablet processes a song completion event while guests add songs, the database state might fall out of sync. Guests must remain create-only; queue transitions should be idempotent and tablet-admin controlled.

---

How does this structural overview align with your vision? If you are ready to begin building, we can start by defining the PocketBase Collection Schema or setting up the Vite configuration for directory-based routing.

You hit on a highly perceptive question. Yes, SmartTube has to interact with YouTube’s APIs to fetch data, search videos, and manage streams. However, SmartTube does not suffer from the 10,000-credit developer quota issue that your custom app faces, and understanding why highlights exactly how you can interact with it.
Here is the breakdown of why SmartTube is exempt, and how searching through it impacts your app's architecture.

## Why SmartTube Doesn't Have Quota Issues

When you create a project in Google Cloud Console, you get a Developer API Key tied to the standard YouTube Data API v3. This API is severely restricted (10,000 credits/day) to force businesses to pay for heavy usage. [1, 2]
SmartTube does not use the developer API. Instead, it uses one of two methods:

1. InnerTube API (Private Scraped Endpoints): SmartTube reverse-engineers the exact internal, unlisted JSON endpoints that official YouTube apps (like Android TV, iOS, or web browsers) use to function. These private endpoints do not have developer quota limits; they treat SmartTube like a standard browser request.
2. Official YouTube TV Sign-In: When you link a Google account to SmartTube, it authenticates as an official, certified "YouTube on TV" application, inheriting the same unlimited usage rights as a retail TV app.

---

## Can You Just "Search Through SmartTube"?

You cannot directly use SmartTube as a search engine for your guest phones, and here is why:

## 1. SmartTube lacks an open inbound Search API

SmartTube is a receiver, not a server. It doesn't host a web server or an API that your Hetzner cloud server or guest phones can ping to say, "Hey SmartTube, search 'Bohemian Rhapsody' and send me back the top 5 results so I can show them on my phone." It only accepts inbound commands to receive and play a specific, known video ID. [3]

## 2. The UX Defeat (Searching on the TV Screen)

## You can physically pick up the Fire TV remote, open SmartTube's built-in search bar, and type with the on-screen keyboard. However, this completely defeats the "Remote Queue" experience of your app. Only one person could search at a time, the video playback would be interrupted by the search UI, and your guests wouldn't be able to use their phones.

## The Big Picture Solution: How to Blend the Two

Your original hybrid architecture (Fuzzy searching a prepopulated database + fallback YouTube API) is still the best approach, but knowing how SmartTube handles data gives you two massive optimizations:

1. You Only Need a Search API, Not a Playback API: You don't need to generate video streams, handle player states, or track video buffering in your app. Your custom app only uses the YouTube Developer API for the text search step when a song isn't in your local database. Once a user clicks a result, you throw the raw YouTube Video ID (youtube_id) into PocketBase, and your app's job is done.
2. The Quota Hurdle is Small with Caching: Because a text-only search request uses 100 credits, your 10,000-credit daily allowance lets you perform 100 deep YouTube searches a day. If your song_library collection is prepopulated with the top 2,000 standard karaoke tracks, your guests will rarely trigger a live YouTube search. The 100-search allowance will easily last through a long party.

Now that the boundary between your App's search logic and SmartTube's media delivery is clear, where would you like to start building? We can set up the PocketBase Collection Schema to hold your cached/prepopulated songs, or draft the Vite + Vue directory routing structure.

[1] [https://www.getphyllo.com](https://www.getphyllo.com/post/is-the-youtube-api-free-costs-limits-iv)
[2] [https://www.getphyllo.com](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota)
[3] [https://github.com](https://github.com/yuliskov/SmartTube/blob/master/PRIVACY.md)

For your software engineering side project, you should adopt the official YouTube API combined with a local database. [1]
While the InnerTube API sounds alluring because it completely removes quota limits, choosing it introduces a different set of maintenance headaches. Since this is an application for personal use and parties, the official API is the more pragmatic engineering choice. [2, 3]

---

## The Comparison

| Vector           | Current DB + Official API                             | InnerTube API (YouTube.js)                                                |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Quota Limits     | 10,000 units/day (~100 text searches).                | Unlimited.                                                                |
| API Stability    | High (Google maintains backward compatibility v3).    | Low (Breaks whenever YouTube updates its internal site scripts).          |
| Response Parsing | Clean, well-structured, human-readable JSON payloads. | Highly chaotic (Formatted to render UI nodes, requiring brittle parsing). |
| Setup Overhead   | Requires a Google Developer Console Account.          | Zero accounts; plug-and-play library node.                                |

---

## Why the Official API + DB Method Wins for This Project## 1. Stability Trumps Quota Freedom

InnerTube is a reverse-engineered private API. Because YouTube frequently tweaks its web apps, the open-source libraries that parse InnerTube (like YouTube.js) frequently break and require patches. There is nothing worse than firing up your application for a karaoke party, only to find YouTube rolled out an update an hour prior that crashes your mobile search screen. The official v3 API is bulletproof and has remained virtually unchanged for years. [2, 3, 4, 5]

## 2. The Quota Math Works in Your Favor

The 10,000 daily credit limit is not a generic request count; different API actions cost different weights. [6, 7]

-
-   A text search (youtube.search.list) costs 100 credits.
-   Therefore, you get 100 deep YouTube searches per day completely free. [1, 8]
-

If your local song_library is preloaded with 2,000 to 5,000 standard karaoke tracks via an initial bulk import script, your friends will rarely need to break past your database to hit the internet. 100 deep searches are more than enough to handle an all-night party's worth of obscure or niche track requests.

## 3. Complexity of Parsing

## The official API returns an elegant array containing videoId, title, and thumbnail. InnerTube returns the massive, highly nested UI tree structure used to render content on a browser. Extracting plain text results out of it requires messy object-traversal logic that turns a simple search implementation into a tedious data-scraping exercise. [3, 9]

## The Ideal Code Architecture with PocketBase

To protect your API key from public exposure on the web app, route the fallback search through PocketBase using its custom server routing layer.

Guest Phone (Vue) ──[Search Query]──► PocketBase Server ──[Attaches Key]──► Official YouTube v3 API
│
(Caches result locally)

You can write a simple backend JavaScript file (pb_hooks/search.js) to handle the fallback routing securely:

// PocketBase server-side hook for an API-shield search endpoint
routerAdd("GET", "/api/karaoke-search", (c) => {
const query = c.queryParam("q") + " karaoke";
const apiKey = process.env.YOUTUBE_API_KEY;

    // 1. Check local PocketBase DB first for a fuzzy match
    // ... if no good local matches, hit YouTube:

    const url = `https://googleapis.com{encodeURIComponent(query)}&type=video&key=${apiKey}`;
    const res = sendHttpRequest({ url });

    // 2. Parse response and perform a write-through cache to your `song_library`
    // 3. Return clean JSON array to Vue frontend
    return c.json(200, res.json);

});

By keeping the official API, your development focus stays on creating a slick UI and handling the SmartTube casting bridge, rather than debugging fragile scraper endpoints mid-party.
Would you like to start drafting the PocketBase database collection rules to ensure the tablet admin can modify the system while keeping guests restricted to write-only access?

[1] [https://www.reddit.com](https://www.reddit.com/r/webscraping/comments/1uaq3lk/keywordsearching_youtube_at_scale_official_api_vs/)
[2] https://ytjs.dev
[3] [https://github.com](https://github.com/lighttube-org/InnerTube/blob/master/README.md)
[4] [https://news.ycombinator.com](https://news.ycombinator.com/item?id=31021611)
[5] [https://www.getphyllo.com](https://www.getphyllo.com/post/youtube-api-integration-101-for-the-developers-of-the-creator-economy)
[6] [https://www.getphyllo.com](https://www.getphyllo.com/post/youtube-api-integration-101-for-the-developers-of-the-creator-economy)
[7] [https://bookdown.org](https://bookdown.org/josephine_lukito/j381m_tutorial/tuber.html)
[8] [https://www.socialcrawl.dev](https://www.socialcrawl.dev/blog/youtube-data-api-2026)
[9] [https://blog.tericcabrel.com](https://blog.tericcabrel.com/retrieve-videos-youtube-data-api-v3-nodejs/)

Additional note: Prefer to use bun as package manager for local dev, but likely npm for remote deployments
