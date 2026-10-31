# Adopt Project-first development and reuse the control plane

## Date

2026-10-31 (Asia/Shanghai).

## Decision

Develop the fork as an AI-centric shared-project code workbench through M0–M6.
Make Project a stable domain boundary; rebuild task navigation and the Project board.
Reuse control-plane services unchanged where possible; put project logic/adapters in
FlyBot. Record scope, architecture and tests in repository memory with implementation.
Do not write repository decisions into live DSH/Bot memory.

## Class

major — fork roadmap, architecture and governing-document scope.

## Evidence

- The fork user accepted the roadmap and requested M0 development.
- The user clarified: “现有的任务栏、project看板需要重构，不要拘泥于当前的ui前端”.
- The user required long-term repository memory, architecture docs and test coverage in PRs.
- [Roadmap #1](https://github.com/zy95-12/FlyBot/issues/1), [M0 #2](https://github.com/zy95-12/FlyBot/issues/2),
  [PR #9](https://github.com/zy95-12/FlyBot/pull/9).

## Participants

The fork user/owner concluded scope through explicit working-conversation instructions.
Codex researched/implemented M0 and records the decision. No upstream participation
or independent code-review approval is claimed.

## Dissent

The user objected: “control-plan你尽量别改啊”. Resolved by closing the unmerged platform
PR and moving verification into FlyBot. No other dissent recorded.

## Status

accepted for fork scope; implementation and merge acceptance remain separate.

## Links

- [Withdrawn platform PR #1](https://github.com/zy95-12/flybot-control-plane/pull/1).
- [Architecture](../docs/architecture.md), [baseline subsystem](../docs/subsystems/demo-baseline.md).
- The 2026-10-29 records remain historical upstream decisions; their conclusions
  and existing merge gates are not rewritten by this record.

Written-by: Codex
