# Closeout evidence tools

These local Python 3 tools collect read-only release and device observations, capture an explicitly
requested local command, and assemble an operator handoff. They do not authorize any follow-up action.
Run with Python's bytecode cache disabled so tool execution leaves no generated package files:

```sh
python3 -B -m tools.closeout --help
```

Release, manifest, capture-run, device, and tablet-status emit a JSON envelope with `schemaVersion`,
`kind`, and a `status` of `verified`, `mismatch`, or `unavailable`. Handoff emits Markdown by default
and supports JSON with `--format json`. Records contain named status and limitation fields; no raw
Coolify errors, command output, environment values, tokens, or party codes are captured.

## Release

```sh
python3 -B -m tools.closeout release \
  --app COOLIFY_APP_UUID --product-sha IMPLEMENTATION_SHA \
  --expected-volume POCKETBASE_VOLUME --mount-destination /pb/pb_data \
  --endpoint https://karaoke-test.example/healthz \
  --docker-context VERIFIED_DOCKER_CONTEXT \
  --container POCKETBASE_CONTAINER --service pocketbase
```

Coolify app and deployment reads use the installed CLI and only allowlisted application fields are
retained. The app record's `git_commit_sha` is reported as configured state; the SHA comparison uses
the `commit` from the latest `finished` deployment chosen by validated `finished_at`. The phase from
the latest deployment by validated `created_at` is reported separately; if it is pending, running,
failed, or unknown, overall status remains unavailable. This is Coolify deployment evidence, not
runtime image label evidence. Missing completed deployment evidence remains unavailable. Container inspection runs only when the caller supplies a Docker context and exact
container/service identity. It checks the container's app and Compose service labels, then matches
the actual mount destination and volume name. If those labels do not establish the exact app/service
association, volume identity is unavailable or mismatched. Generated Coolify storage metadata is not
accepted as live mount proof; in the inspected CLI output, storage records exposed the mount path but
no source or volume name. Health is a credential-free GET; redirects are not followed and URLs with
user info, query, or fragment are rejected. Its app association is caller-supplied and unverified.
CLI failure details and raw output are discarded.

## Local run and manifest

The manifest fingerprints declared content paths, reports branch/HEAD independently from the
implementation SHA, and fingerprints dirty paths to preserve their contents across closeout. A
manifest verifies only a scoped snapshot; it does not claim that a command ran. Reuse comparison
accepts only a successful, stable `run` record and compares scoped content, command, selectors, and
runtime, including the exact command fingerprint, executable, and collector hashes. Missing, outside,
unreadable, directly symlinked, or symlink-ancestor scope entries fail closed as unavailable. An
unreadable Git status also makes dirty-preservation evidence unavailable; `capture-run` stops before
running the command in that case. HEAD may move for documentation-only changes without invalidating
the comparison. The fingerprint proves only the declared scope, and JSON records are not cryptographic
attestations.

```sh
python3 -B -m tools.closeout manifest --root . \
  --implementation-sha IMPLEMENTATION_SHA --scope src pocketbase companion-android \
  --command bun test:unit --run --selector src/__tests__/tablet.spec.ts \
  --runtime 'Bun x.y; Node x.y' --compare-run /absolute/path/to/prior-run.json \
  --evidence /absolute/path/to/validation.json
```

`capture-run` is an explicit local command runner, not a safety sandbox. It records argv, exit status,
timeout, runtime, selectors, and before/after fingerprints for the declared scope. It discards stdout
and stderr, does not turn imported logs into execution proof, and marks failures, timeouts, or scope
changes as non-verified. The scope must exist before execution. A successful run record includes dirty
file preservation hashes, collector and executable hashes, and the collector's Python version. The
command fingerprint identifies the complete argv while stored arguments redact credential flags,
URL query strings, and inline code. The artifact must be new and outside the repository; it is created
with an exclusive write and is never overwritten.

```sh
python3 -B -m tools.closeout capture-run --root . \
  --implementation-sha IMPLEMENTATION_SHA --scope src pocketbase \
  --selector src/__tests__/tablet.spec.ts --runtime 'Bun x.y' \
  --output /absolute/path/to/new-artifact.json -- bun test:unit --run src/__tests__/tablet.spec.ts
```

## Fire identity and tablet status

The ADB collector requires the exact serial and expected model/product/device identity. A mismatch
stops before package queries. It records the Android release, then reads `pm path`, package details,
and the installed APK hash where
the device permits; it never pulls, installs, or replaces an APK. Supply the expected local APK path
and SHA-256 explicitly.

```sh
python3 -B -m tools.closeout device --serial SERIAL \
  --expected-model KFTRWI --expected-product trona --expected-device trona \
  --apk-path /absolute/path/app-debug.apk --apk-sha256 SHA256 --package net.example.companion
```

Tablet status uses the existing constrained endpoint and party ID. The caller provides its
short-lived `tablet_admin` bearer token on stdin; do not put it in shell history, files, or arguments.
For example, use an existing approved secret-input mechanism to pipe the token. The tool emits only
party id/status/expiry and the controller's sanitized state. It marks convergence verified only when
the fresh (90-second) controller state is connected, reports `playing`, and matches the currently
playing queue item's YouTube ID. A stale state is unavailable; a fresh mismatch is `mismatch`. This
remains controller evidence, not physical-TV proof.

```sh
python3 -B -m tools.closeout tablet-status --endpoint https://karaoke-test.example \
  --party-id PARTY_RECORD_ID --token-stdin
```

## Operator handoff

The handoff command consumes schema-versioned collector records and requires implementation SHA and
documentation HEAD as separate inputs. It emits Markdown by default or JSON with `--format json`.
It includes validated diffs, test selectors, release/device/controller observations, reported approval
source/actions/targets/effects/exclusions, and mandatory pending observations for physical TV identity,
playback progression, natural completion, and restart. A manifest can attest to a scoped snapshot but
cannot prove a test ran. Markdown separates evidence status from readiness, lists required release,
device, and controller domains, shows captured run details and record paths, and labels diff/test prose
as operator-reported notes. Missing domains or pending physical proof keep readiness unavailable.
Approval prose is contextual evidence only; the generated handoff explicitly does not grant authorization.

```sh
python3 -B -m tools.closeout handoff --implementation-sha IMPLEMENTATION_SHA \
  --documentation-head DOC_HEAD --record /absolute/path/release.json \
  --test 'bun test:unit --run' --diff 'src change reviewed at IMPLEMENTATION_SHA' \
  --approval-source 'current human approval reference' --approved-action 'exact action' \
  --target 'exact target' --effect 'expected effect' --exclusion 'excluded action' \
  --output /absolute/path/new-handoff.md
```

## Tests

Focused standard-library tests can be run without creating bytecode or generated repository files:

```sh
python3 -B -m unittest tools.closeout.test_closeout tools.closeout.test_behavior
```
