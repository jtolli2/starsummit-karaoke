# Go-Live Party Checklist

## Before guests arrive

- Confirm the retained frontend and PocketBase deployments report healthy and expose the same-origin
  `/api` and realtime paths. Record the deployed product SHAs in the party notes.
- On the tablet, sign in with the constrained `tablet_admin` account and confirm the controller is
  connected with a fresh heartbeat. Confirm the QR code is readable from a phone at the venue.
- Verify SmartTube is paired and ready. If controller delivery is unavailable, use the Fire TV remote
  to open the selected YouTube video manually; do not expose companion pairing material or browser
  credentials.
- Confirm the server-side YouTube quota is available through the operator diagnostics without
  recording credential values or identifiers.
- Confirm the primary YouTube credential is configured without displaying it. The backup credential
  is manual development fallback only in the MVP; do not expect automatic failover or retry an
  ambiguous request with another key.

## Start the party

- Create a fresh 12-hour party from `/tablet`; verify the random code, expiry, and QR join URL.
- Join once as a guest, search an approved local song, request it, and confirm the tablet queue
  refreshes after its SSE wake. Treat the HTTPS queue refetch as authoritative.
- Before starting a song, verify the tablet shows a fresh controller heartbeat. Start the next item
  once and wait for the companion acknowledgement and now-playing state before issuing another
  action.
- Use tablet Play or Pause only after the controller video matches the active queue item. Treat
  “requested” as pending; wait for the authoritative player state and opposite enabled control
  before repeating an action. An uncertain retry reuses the same durable operation identity.

## During the party

- Guests use local search first. A YouTube search is always an explicit action after a true local
  miss; cached exact replays should not reserve quota again.
- Only high-confidence karaoke fallback candidates are requestable. Keep ambiguous, lyric, audio,
  live, and unreviewed discoveries for later operator review rather than approving them mid-party.
- If a guest or tablet reloads, rejoin or restore the constrained session and wait for the current
  authoritative HTTPS state; do not infer queue state from an SSE payload.
- If the companion process restarts, wait for session establishment, accepted realtime
  subscription, a zero-or-bounded authoritative command refetch, and unchanged current video before
  issuing another operator transition.
- If an acknowledged Open Video command does not converge to the selected video, use the companion
  or Fire remote manual Open Video fallback, then refresh the tablet and verify the matching video
  ID before using Play or Pause. Record the non-convergence without exposing Lounge credentials.

## After observations

- Record party code, deployment SHAs, controller command sequence, unexpected errors, and any
  manual SmartTube fallback used. Do not record temporary guest credentials, API credentials,
  controller tokens, or Lounge pairing data.
- Preserve the party and audit records for diagnosis. This checklist intentionally contains no
  cleanup or deletion procedure.
