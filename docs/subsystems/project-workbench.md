---
subsystem: project-workbench
owned_paths:
  - core/src/host/project-scheduler.js
  - core/src/host/project-repository-policy.js
  - core/src/host/workbench-gateway.js
  - core/src/host/workbench-state.js
  - core/src/client/workbench
  - core/workbench.js
  - core/workbench.css
  - core/scripts/build-workbench.mjs
  - core/test/workbench-client.test.js
  - core/test/workbench-gateway.test.js
  - core/test/project-scheduler.test.js
  - core/test/project-repository-policy.test.js
---

# Project workbench (fork M5)

The shared entry is a separate browser application, built with esbuild into committed
`core/workbench.js` and `.css`. The legacy operator UI remains available at the private
Harness entry. Members receive only the restricted gateway URL. Never share the Harness
owner login URL/cookie: doing so would expose raw Session APIs outside Project policy.

## Entry and identity

`workbench-gateway.js` listens on loopback, proxies only an explicit `/api/bot` endpoint
allowlist to one fixed loopback runtime, and holds its owner cookie server-side. There
is no arbitrary URL proxy. Host, Origin and fetch-site checks, request limits, CSP,
no-store and cookie/redirect stripping protect this boundary. Deploying it externally
requires an operator-configured reverse proxy and fixed `--public-origin`; it does not
provision TLS or alter control-plane. The gateway is a trusted server component, not a
substitute for the runtime's membership checks. Only the member session header crosses
from browser to FlyBot; owner credentials never appear in HTML, JS or local storage.

The app calls `auth-mode`, then the existing platform-login BFF or redeems a local member
invitation for isolated tests. Member credentials live in origin-scoped sessionStorage.
Platform account management links to the existing control-plane. There is no duplicate
account database or new control-plane source. Local initial invitations are operator
issued; the shared entry cannot mint unauthenticated owner sessions.

## UI and data

Project switching, deep-linked Tasks, Task board/create/run/retry, Attempt evidence,
verified test logs, PR links, commit-specific human acceptance/return, stop/cleanup,
member invitations/roles/removal, public Chief/role configuration and private Project
agent conversation/notes/proposals use actual backend endpoints. No simulated delivery
or PR actions. Permissions hide controls for convenience; the server remains authoritative.

Every refresh captures an epoch and Project id and aborts prior requests. Late responses
cannot replace another Project's content; membership failures clear the displayed scope.
A deep-linked Task must belong to the selected Project even if the human can read both.
Untrusted content is rendered using textContent; no HTML interpolation. Form drafts are
Project/view scoped; polling preserves active input focus/cursor. Logout clears drafts
and selected data. The responsive layout collapses below 900px. There are no remote assets.

## Admission and lifecycle

`project-scheduler.js` adds a durable *admission queue* around the existing delivery
service, not a second Workflow executor or Task store. At quota, a request stores
Project/Task/request hash/requester before allocating any Attempt or worktree. Duplicate
requests reuse the same queue/Attempt. A serial drain checks current membership, Task
state and Project status before starting the existing versioned delivery Workflow.
Removal cancels waiting work; admitted running work continues under Project authority.
Archived Projects block pending entries; the requester or manager can cancel them.
Startup reconciles interrupted `starting` entries against existing Attempts.

Slots deduplicate canonical active Runs, preparing/running Attempts and orphan Workers
by Attempt id. Failed Worker release continues to consume capacity. Owner/Maintainer
stop uses the existing single-Run Workflow reset/release path. No slot is fabricated free
while Workers remain. Cleanup and terminal Run reports wake the queue. A one-second
unref timer operates only in workbench mode and only after Workflow handlers are ready.
Project deletion refuses live queue requests. Project Tasks are not implicitly pruned
from history by legacy task retention.

Operator repository config grants filesystem/tests/automation capabilities. Its
`allowedProjectOwnerIds` defaults to `["owner-1"]`; shared members can execute Tasks
inside that owner's Project, but cannot create another Project with the same repository
name to inherit the capability. Shared callers cannot provide arbitrary workDir values.
Scoped agent/worker Project identities cannot be rebound.

## Resources and evidence

Resource cards show real concurrency, queue, Worker and Workspace records. CPU/RSS are
measurements of the *shared host process*, never per-Project guarantees. No GPU or
unreported limits are invented. The unchanged platform `/api/instance` response belongs
to the current caller's account instance and is explicitly separate from the execution
host. Missing data is unavailable.

Metrics use a rolling seven-day window and actual human-accepted Attempts: unique Tasks,
sample count, mean and median Task-created→accepted durations (queue/execution/human wait
included). No samples yields null, not zero or a simulated throughput.

Tests cover delayed cross-Project responses, revocation, deep-link ownership, XSS, member
controls, scoped Task creation, gateway escape routes/cookie isolation, quota/recovery,
repository capability ownership and real DSH queue/drain/revocation. `npm run verify`
checks generated assets. M6 owns full two-account browser acceptance; deterministic model
transport is not real-model delivery or an independent repository review PASS.

### M6 acceptance and launcher

`dev/demo/control_plane.py --workbench-check` drives two real control-plane accounts,
Chromium contexts and the shared gateway against a fresh actual DSH. `--serve-workbench`
starts a disposable interactive demo with privately entered account passwords. An
explicit `--real-model` selects existing environment configuration; missing key/base URL
fails before startup and cannot silently fall back to a fixture. Explicit GitHub fork and
credential directory flags enable Project automation drafts. Only the gateway and existing
platform URLs are printed, never the Harness owner login or account passwords.

The UI identifies deterministic demo transport, provides explicit accessible form names
(including selects), and reads actual Workflow node status alongside Attempt evidence
and workspaces. Browser tests await route-specific content before interacting with a
similarly named form in the next view. See [shared demo acceptance](../shared-demo.md)
for reproducible commands, evidence matrix and pending live-model acceptance.

The Task view shows priority, source Issue/PR, context/criteria, age, current role/Worker
workspaces, Attempt elapsed time, real diff statistics and explicit failure/return reasons.
Board cards sort by the existing urgent/high/normal/low contract. Active or terminal Tasks
cannot start a duplicate delivery from the UI, and requester input waits use the existing
question-id-bound answer endpoint; approval waits retain their separate server gate.


### Fork M7.1 — 2026-10-31

M7.1 allows project-role-memory-write through the restricted gateway. This public-memory operation still requires live Project configure authorization. Resource/Harness settings UI and terminal access are tracked separately in M7.4.


### M7.2 — 2026-10-31

M7.2 project-resources includes executionResources and sanitized resourceLeases. Connection targets, roots and worker handles remain server-side. Resource/role capacity blocks the existing queue before Attempt/worktree creation; unknown external workers keep Project slots occupied.


### M7.3 checkpoint — 2026-10-31

M7.3 resources read model includes sanitized Harness worker status/pending questions. Event-log and cwd paths remain server-side. The gateway allowlists only scoped project-execution-input, not arbitrary SDK or filesystem commands.


### M7.4 — 2026-10-31

M7.4 Owner forms preserve existing persona/Skill/memory/defaults and offer multiple resource checkboxes. Each target shows independent Harness status and probes. Explicit resource admins can open a private line-input PTY; input is never a persisted form draft. HTTP uses existing Origin/Host guards and all WebSocket upgrades are refused.


### M7.5 — 2026-10-31

M7.5 real browser integration exercises Owner role Harness/resource edits and private PTY, refuses Member terminal access and preserves accurate unconfigured SDK status. Runtime/terminal/input channel wiring is corrected and directly tested. Attempt UI reads only scoped sealed execution logs. Full positive paid mixed-resource acceptance remains pending profiles.

## R1 repository capability preflight

Repository configuration requires a nonempty relative path allowlist and valid argv. New admission and queue drain check the actual Git root/HEAD, test executable, declared testDependencies and writable workspace/artifact parents before allocation. The workbench uses the same metadata preflight (briefly cached for polling); every admission bypasses that cache. A blocked repository reports a safe field/reason rather than a false configured flag or silent disabled button. Readiness explicitly says tests are not run; it does not execute operator commands or model probes. Fixing provisioning does not mutate previous failed Attempts; a blocked queue request can be retried with a fresh request id.

Operators may run `node scripts/check-project-provisioning.mjs CONFIG.json OWNER/REPO OWNER_ID` against an explicit JSON object containing the same `home`, `dshHome` and `config` used by their service. It checks metadata only and never prints configuration contents or credentials. Include `allowedPaths` in the actual repository capability; use concrete repository-relative files/directories, never a filesystem-wide wildcard. If the test wrapper prepares dependencies per worktree, declare prerequisite paths only when they must already exist in the operator repository.


Repair R3 (#36): Admission plans only the first receiving role in pool mode. The existing admission wake also asks each logical Bot pool for executable candidates; a busy resource leaves its destination Task queued. Per-Bot visibility is exposed through membership-guarded `project-task-pools`. See [pool contract](project-pools.md).
