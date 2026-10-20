# Closeout Evidence Tools

## Status

Complete — reviewed local tooling; live mount, constrained controller authentication, and physical UI/TV proof remain explicitly unavailable or pending.

## Goals

- Capture sanitized release, local-run, device, and operator-handoff evidence through explicit local CLI invocations.
- Keep implementation identity, documentation checkout identity, retained resources, and physical proof distinct.
- Never mutate Coolify, Docker, Android, PocketBase, or other remote/device state.

## Implementation Decisions

- Verified baseline is `main` at `47e480c6c7bdac9b10abb769a8e1d1449d75f941`. Existing workflow edits are preserved and are outside this assignment.
- Installed Coolify CLI is 1.6.2. `coolify app get <uuid> --format json` and `coolify app deployments list <uuid> --format json` are available. The inspected storage-list output exposed mount path metadata but no source or volume name, so it could not prove the live Docker mount.
- Tablet status is the existing constrained `GET /api/karaoke/tablet/status?partyId=...`; it requires a tablet operator and its party includes a code for its owner. The collector must not retain party codes. Controller freshness is limited to the endpoint's current status and its `observedAt` value; it does not prove physical TV behavior.
- New local CLI contract: `python3 -B -m tools.closeout ...`, consumed by operators and the generated handoff. Evidence records are versioned envelopes with `verified`, `mismatch`, or `unavailable` outcomes; handoff emits Markdown by default. No Vue, PocketBase, or Android contract changes.
- Release reads use Coolify app and deployment CLI commands. The latest finished deployment commit is reported separately from configured SHA and the newest deployment phase. A caller-supplied Docker context/container/service must verify container identity, app/service association, running/health state, and exact named read-write volume mount. Credential-free health GET does not follow redirects; its host/path association remains a caller-supplied target. Parent read-only smoke queried the retained staging app; its latest completed product SHA matched, while live Docker mount proof remained unavailable without an authenticated Docker context.
- Run capture executes only an explicitly supplied local argv, fingerprints declared scope before and after, captures dirty-path preservation hashes, runtime/executable/collector fingerprints, and result without raw logs or environment values. Missing, outside, unreadable, directly symlinked, or symlink-ancestor validation scope entries fail closed as unavailable. A failed Git status read or unreadable dirty path makes preservation unavailable; capture stops before execution if the initial preservation state is unavailable. Reuse accepts only a successful stable `run` record with matching scoped content, implementation SHA, exact command fingerprint, executable, collector, selectors, and runtime; documentation-only HEAD movement does not invalidate it. Records are not cryptographic attestations.
- Device inspection is read-only and requires exact ADB serial/model/product/device identity and APK path/hash/package. Identity mismatch stops subsequent queries; package and device-returned APK path are validated before ADB shell arguments. Tablet status requires HTTPS and an ephemeral stdin token, emits no party code/token, and verifies only fresh connected controller state matching the currently playing queue video. Physical TV proof remains separate.

## Minimal Delta

- Add feature-local Python CLI and README under `tools/closeout/`, focused standard-library tests, and this specification only.
- The only new shared/public contract is the local CLI invocation and its versioned records/Markdown handoff, justified by operator consumption across release/run/device/handoff capture. Helpers remain private to the package.
- No modifications to `context/current-feature.md`, existing workflow files, runtime product code, remote resources, device state, or generated tracked artifacts.

## Validation and Handoff

- Final parent-owned capture ran `python3 -B -m unittest tools.closeout.test_closeout tools.closeout.test_behavior`: 30 tests passed, exit 0, stable scope and dirty-preservation fingerprints. Python 3.14.2, standard library only. Accepted scope SHA-256: `206620f9c002461707e474142044fe04e9890b8a0c0bede88b7357682934be5b`.
- Independent behavior tests, assignment review, and integrated final review completed. Review corrections cover exact command/runtime attribution, invalid/symlink scopes, raw Git porcelain preservation, malformed evidence, uncertain deployment chronology, and handoff implementation identity. No blocking findings remain.
- Read-only Fire smoke verified serial `192.168.0.244:5555`, model `KFTRWI`, product/device `trona`, installed package `net.starsummit.karaoke.companion`, version `0.1.0`/code `1`, and installed/local APK SHA-256 `9a28a1c6eda0ce1d46a4106ac3bb6223c4109c05317fd1af0a3f98d64e334c32`. No install, launch, restart, or playback action occurred.
- Live release observation reports deployed baseline `3937a48671a15284aa45b7debb8fa8448eb4e701`; this is not deployment of the uncommitted tools. Actual Docker mount identity remains unavailable. Controller check without an approved token returns unavailable before any network request; no browser-session export or superuser shortcut was used.
- Artifacts: `/Users/chefjeff/.codex/artifacts/starsummit-closeout-tools-20261019T204936/validation.json`, `revision.json`, and `final-handoff.md`. Earlier run/handoff records in that directory are superseded; they were preserved rather than overwritten or deleted.
- All 12 pre-existing dirty/untracked workflow files match the original preservation hashes. `context/current-feature.md` and the pending SmartTube operational record remain untouched. No new commit or implementation commit SHA exists; evidence identifies the uncommitted diff against base `47e480c6c7bdac9b10abb769a8e1d1449d75f941`.
- Authorization is the initial implementation request in this chat: local non-destructive implementation/testing and read-only diagnostics only. No commits, pushes, deployments, remote mutation, device install/launch/restart/playback/pairing, storage changes, deletions, or memory edits were authorized or performed.
- Required real UI and physical-TV identity, playback progression, natural completion, and continuity across restart remain separate pending observations. A generated handoff cannot grant or broaden approval.
