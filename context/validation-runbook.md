# Independent Browser and Tablet Validation

Use this runbook for delegated live browser/tablet validation. It is a procedure, not authorization
to change retained staging, devices, or other remote state. Read-only preflight does not authorize
mutations.

## Browser profile and sign-in

1. Create or select a dedicated local Chrome profile named **Starsummit Development**. Do not turn
   on Google sync or import browsing data. The profile is a setup target; its existence must be
   verified each run and must not be assumed from this document.
2. In the product's **Settings > Computer Use > Chrome Install/Manage** flow, install/manage the
   official extension in that exact profile. Follow the
   [official Chrome extension setup](https://learn.chatgpt.com/docs/chrome-extension).
3. A human signs in once with the constrained `tablet_admin` account at
   `https://karaoke-test.app.starsummit.net/admin`. Never place its password, token, cookie, or
   session material in docs, logs, source control, or evidence. Reuse that profile's existing
   authenticated session until it expires; if expired, stop and ask the human to sign in again.
4. At the start of each delegated run, independently inventory accessible tabs and confirm the
   intended page, authentication state, and non-secret `tablet_admin` role evidence before any
   expiring grant is created. The root in-app-browser scope differs from the delegated Chrome
   scope. Chrome has been commonly available, but availability and visibility are not guaranteed;
   verify them rather than inferring either from another agent's inventory.

## Delegation and scope

Assign one owner for all browser/tablet interaction. The parent must not operate the same UI
concurrently. Use a compact, no-fork brief that names the owner, exact targets, test actions,
required approvals, exclusions, and the evidence to return. Include the app/device identity and
the action sequence; do not rely on a prior run's approval.

Before the run, confirm the needed UI/browser/device tools are available, authentication is current,
and target identity is established. Capture evidence at meaningful milestones. Use bounded event waits
within tool limits instead of short repeated polls. Send required user progress updates during longer
work; otherwise report at meaningful milestones or when state changes. Stop and escalate if access,
identity, approval, or authoritative state is uncertain.

Every remote mutation or deletion requires current, explicit user approval for that exact action
and target. A historical summary is not itself authorization; verify the original explicit approval
and reuse it while it still covers the same action, target, and expected effect. Before operating the
Fire tablet, run `adb devices` and verify the attached Fire identity; never guess a serial, device, or
IP address.
For Coolify, use the locally authenticated `coolify` CLI first where it supports the read. For each
application read, use a same-command allowlisted `jq` projection; do not print full objects or
rendered environment values. Retained app `wyxit9qifbwgskjrwibxb330` is a reference to re-verify,
not deployment or mutation approval.

For closeout, record the exact deployed implementation SHA and health. Compare the actual mounted
PocketBase volume identity mechanically with the expected identity using available evidence; do not
infer the mount from generated metadata, and do not repair or replace state automatically. Use a direct
API only if inspection confirms the CLI cannot provide a required value; pin the SHA only after that
gap is verified and keep the same approval boundary. Preserve dirty local files using before/after
fingerprints, and record APK hash plus verified device identity when relevant.

Preserve Lounge pairing, unrelated app/server records, and external volume state. Do not perform
catalog, party, queue, matcher, YouTube, playback, Lounge, Wi-Fi, DNS, or cutover actions unless
they are named in the current approved scope. Report blockers instead of expanding scope.

## Pairing and state evidence

Record the observed phases separately: grant creation, grant redemption, device/session presence,
heartbeat, companion connection state, and authoritative status after a fresh admin read. A
successful redemption or a session record is not proof of `connected`; verify the refreshed
authoritative admin state. After any approved pairing change, include a companion restart and
another fresh authoritative status read when required by the test scope.

Distinguish a physical camera QR scan from decoding a QR payload or following a link. A decoded
payload or successful Android resolver does not prove camera scanning or Chrome-button behavior.
Likewise, distinguish encrypted-file changes from evidence about logical Lounge pairing
preservation; only report what was actually inspected. Do not infer record IDs or counts from a
successful status response.

An API/CLI helper may be considered later only with narrowly scoped runtime credentials obtained
from an approved secret manager or authenticated CLI. Never create a plaintext credential file,
use a superuser browser session, or export browser cookies/session state. API/CLI evidence is
non-UI evidence and does not replace testing the real UI.

## Brief and report templates

```text
Owner:
Target app/page and verified browser profile:
Target Fire identity (if used):
Approved actions and approval reference:
Excluded actions/state:
Evidence to capture (non-secret):
Stop/escalation condition:
```

Return the exact actions attempted, phase-by-phase observations, timestamps or response/status
indicators needed to interpret them, and checks not exercised. Redact all credentials, tokens,
cookies, QR launch secrets, and sensitive CLI/API output. If setup, authentication, target identity,
approval, or state evidence cannot be confirmed, stop and report that boundary for the parent to
resolve.

Keep sanitized server convergence evidence, including fresh authoritative reads, distinct from
physical-TV evidence. Report untested TV behavior explicitly. The original implementation, operations
closeout, and any newly discovered product fix have separate scopes. Existing explicit approval remains
valid only while it covers the exact action, target, and expected effect; do not ask again within that
scope or extend it to new actions.
