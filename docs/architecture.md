# FlyBot Architecture

FlyBot is a team of long-lived Bots built on DeepSeek Harness (DSH). Two parts ship: the `ds-bot` plugin (patched upstream) and the desktop app.

## Fork direction and M1 boundary

The accepted [Project-first fork direction](../decisions/2026-10-31-project-first-fork.md)
makes Project the stable boundary for Tasks, Runs and Workspace references. M1
implements direct ownership, explicit migration, lifecycle rules and a Project service/
repository/policy boundary. See the [Project domain contract](subsystems/project-domain.md).
Bots/Sessions remain replaceable carriers; physical worktree isolation is M3. Reuse control-plane APIs unchanged where
possible; put new project logic/adapters in FlyBot. Task navigation and the Project
board may be rebuilt without preserving their current components or layout.

M0 adds [development tooling](subsystems/demo-baseline.md), not a runtime service or
platform patch. Its real DSH/tool execution uses a deterministic model; its separate
HTTP adapter exercises unchanged external platform source. It does not enable team
mode, bypass shared-write authorization, deploy the platform or add a scheduler.
Known identity, authorization and per-run cwd gaps remain in [Project State](../PROJECT.md).


M2 adds the [shared access boundary](subsystems/project-access.md): an explicitly
configured FlyBot BFF over unchanged control-plane authentication plus Project-owned
roles/invites, runtime context and a scoped gateway to the existing Workflow service.
It validates sessions on every request and denies legacy unscoped plugin surfaces in
workbench mode. The inherited general team-mode proposal below remains historical;
this fork's Project collaboration contract is narrower and separately tested.

M3 wraps that existing Workflow service with [commit-specific delivery](subsystems/project-delivery.md):
versioned immutable Attempt/role/model snapshots, per-role Git worktrees outside DSH data,
independent test processes, typed Review/SHA gates, explicit GitHub draft publication and
human acceptance. Restart records interruption; retry preserves evidence. Actual DSH and
GitHub fixture proof is available; true-model/browser acceptance is tracked separately.

## Layout

| Path | What it is |
| --- | --- |
| `ds-bot/` | Pristine upstream pin (Fei2411/DeepSeek-Bot). Never edit. |
| `patches/ds-bot/` | Ordered FlyBot patches on the pin. |
| `core/` | `ds-bot/` + patches. Ships; all tests run here. |
| `plugins/social/` | `@flybot/social` — social posting plugin. |
| `plugins/tree/` | `@flybot/tree` — knowledge-tree plugin. |
| `plugins/timeline/` | `@flybot/timeline` — where time goes across the local Bot team (swimlanes, communication map, utilization). |
| `plugins/workflow/` | `@flybot/workflow` — a group-shaped chat of local Bots, with a flowchart and task assignment. |
| `app/` | Desktop app (Windows/macOS) for the DSH + plugin. |

## Subsystems

Each subsystem has a detail page under [docs/subsystems/](subsystems/README.md) with owned paths, invariants and tests:

- [ds-bot-core](subsystems/ds-bot-core.md) — pin, patch format and dev tooling of the patched core; [core-host](subsystems/core-host.md) and [core-client](subsystems/core-client.md) — its server and browser code
- [plugin-runtime](subsystems/plugin-runtime.md) — FlyBot plugin hooks
- [tree](subsystems/tree.md) — `@flybot/tree`
- [timeline](subsystems/timeline.md) — `@flybot/timeline`
- [workflow](subsystems/workflow.md) — `@flybot/workflow`
- [social](subsystems/social.md) — `@flybot/social`
- [install](subsystems/install.md) — scripts and install doctor
- [team](subsystems/team.md) — planned human/Chief/specialist authority contract (not shipped); #47–#50 are data/auth/room-membership foundations only

## Team authority (planned, not shipped)

Multi-human ownership is **planned, not shipped**. The proposed contract — human owner ↔ designated Chief ↔ specialists, owner-scoped management, Chief-only cross-owner traffic, approval authority and the routing matrix — lives in [docs/subsystems/team.md](subsystems/team.md). Schema (#47), member sign-in (#48), owner-scoped access (#49) and typed room membership (#50) are foundations on that page; **team mode stays disabled** until that page's authorization gates pass. Issue #16 is resolved: tree Bots may create children under themselves (Option B; see [tree](subsystems/tree.md)).

## Integrating

See [docs/integrating.md](integrating.md) for how to add a plugin or integrate with DSH.

Cross-runtime collaboration is proposed in [#198](https://github.com/ThinkFlowLab/FlyBot/issues/198).
The [room participant contract](interop/room-participants.md) scopes the same-room
DSH + DSH baseline and DSH + OpenCode target. Its current implementation extracts
the DSH execution boundary only. The earlier [OpenCode pilot
contract](interop/opencode-pilot.md) and offline harness cover a Bot Social
transport experiment with independent owner identities; they preserve its
same-owner friendship restriction and do not satisfy the room target. No
OpenCode adapter or additional team-mode gate is enabled.

## Reference

See [docs/reference.md](reference.md) for API and CLI reference material.
