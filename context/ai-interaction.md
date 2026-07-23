# AI Interaction Guidelines

> Operating rules for agents working in this repository, including scope, validation, and approval boundaries.

- Make the smallest change that satisfies the active feature goals.
- Read the project overview and current feature before changing code.
- Do not invent unresolved product behavior; record the decision needed in the feature notes.
- Explain non-obvious architecture or security decisions briefly.
- Run relevant tests and the production build before reporting implementation complete.
- Ask for explicit approval before committing, pushing, merging, deploying, or deleting files or branches.
- Do not expose credentials or add client-side access to privileged PocketBase or playback controls.
- Prefer the Coolify CLI for supported Coolify reads and approved mutations. Use the read-only
  Coolify MCP for discovery or verification; use direct API calls only when the CLI lacks the
  required operation. Keep credentials out of commands, output, commits, and documentation.
- Treat `YOUTUBE_API_KEY_BACKUP` as a server-only manual development fallback until a separately
  scoped automated-failover enhancement is implemented. Do not expose either credential.
