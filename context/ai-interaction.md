# AI Interaction Guidelines

> Operating rules for agents working in this repository, including scope, validation, and approval boundaries.

- Make the smallest change that satisfies the active feature goals.
- Carry a scoped feature implementation through `load`, `start`, `test`, `review`, `explain`, and
  `complete`, ending with a reviewed implementation and closeout-ready handoff. Do not stop at stage
  boundaries; follow the feature skill's blocker criteria and honor explicit user scope limits.
- Read the project overview and current feature before changing code.
- Do not invent unresolved product behavior; record the decision needed in the feature notes.
- Explain non-obvious architecture or security decisions briefly.
- Prefer the smallest viable delta and preserve behavior already verified by tests or runtime
  evidence. For a single consumer, keep composition feature-local; introduce a shared or public
  contract only when its current consumers and the justification are named in the feature notes.
- Do not add speculative Vue props, emits, pass-through callbacks, composables, stores, shared
  types, PocketBase validators, endpoints, collections, schema or migrations, helpers, or Android
  service, IPC, or lifecycle surfaces. Keep validation at the boundary that owns the rule; repeat
  it only when distinct contracts or failure modes require it.
- Match validation to the changed behavior. Product changes require the relevant unit tests and
  production build, with backend, Android, and pinned PocketBase checks when affected or required by
  the active goals. Documentation and configuration follow-ups do not require unrelated product
  tests or builds.
- For nontrivial product work, use planner, bounded coder assignments, tester and task review per
  assignment, then one integrated final review. For a small, low-risk follow-up, use attributable
  checks and one independent review; involve tester only to fill an identified gap. Repeat broad
  review for contract, authorization, shared-behavior, or substantial integration changes.
- Reuse current evidence tied to the reviewed revision or working-tree diff. Request targeted checks
  for specific gaps, and reuse the assigned implementer for corrections within the same assignment.
- Keep implementation readiness distinct from full user-goal completion and live validation. Prepare
  the implementation closeout handoff even when operational work remains; see
  `.agents/skills/closeout/SKILL.md`.
- Tests should protect observable or documented API, security, persistence, and runtime behavior,
  not hypothetical states or implementation details.
- Ask for explicit approval before committing, pushing, merging, deploying, or deleting files or branches.
- Do not expose credentials or add client-side access to privileged PocketBase or playback controls.
- Prefer the Coolify CLI for supported Coolify reads and approved mutations. Use the read-only
  Coolify MCP for discovery or verification; use direct API calls only when the CLI lacks the
  required operation. Keep credentials out of commands, output, commits, and documentation.
- Treat `YOUTUBE_API_KEY_BACKUP` as a server-only manual development fallback until a separately
  scoped automated-failover enhancement is implemented. Do not expose either credential.
