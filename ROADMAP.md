# FlyBot — Roadmap

## Active fork roadmap — 2026-10-31

The owner-approved plan is [fork #1](https://github.com/zy95-12/FlyBot/issues/1), recorded
in [the fork decision](decisions/2026-10-31-project-first-fork.md). Historical upstream
stages below do not restrict the fork's approved Project and frontend refactor.

| Milestone | Deliverable | Status / issue |
| --- | --- | --- |
| M0 | Isolated DSH/tool/cwd/lifecycle and unchanged-platform HTTP checks | Merged PR #9; [#2](https://github.com/zy95-12/FlyBot/issues/2) |
| M1 | Project domain and direct Task/Run/Workspace ownership | Implemented, verification/review in progress; [#3](https://github.com/zy95-12/FlyBot/issues/3) |
| M2 | Shared membership, platform identity adapter and backend authorization | Planned; [#4](https://github.com/zy95-12/FlyBot/issues/4) |
| M3 | Worktree, code/tests/PR/review evidence and human acceptance | Planned; [#5](https://github.com/zy95-12/FlyBot/issues/5) |
| M4 | Public project Bots and private user/project agents | Planned; [#6](https://github.com/zy95-12/FlyBot/issues/6) |
| M5 | Rebuild task navigation, Project board, details and resource view | Planned; [#7](https://github.com/zy95-12/FlyBot/issues/7) |
| M6 | Repeatable two-user end-to-end acceptance | Planned; [#8](https://github.com/zy95-12/FlyBot/issues/8) |

The owner authorized sequential M1–M6 implementation, one PR per milestone. Each PR
updates long-term memory, architecture and tests. Merge status is tracked separately.

Reuse platform services unchanged first; new project logic/adapters belong in FlyBot.
M0's deterministic model and existing shared-write denials do not imply M2/M3 completion.
GPU pools, multi-host scheduling, auto-merge and exact crash resume remain deferred.
The 30–43 person-day estimate is provisional pending interfaces/frontend design.

## Historical upstream roadmap


What the project is doing now, in what order, and what it deliberately is not doing. The plan of
record is the accepted proposal [#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550)
(approved by the owner on 2026-10-29, recorded in
[decisions/2026-10-29-stage-1-approved.md](decisions/2026-10-29-stage-1-approved.md)). This page
tracks that plan; it does not replace it.

**Active stage: Stage 1 — run FlyBot development as an AI-governed Project (dogfood first).**

## Priorities today

1. **Stage 1 dogfood, in slices.** Prove the governance loop with the Bots, groups, tasks and GitHub
   this repository already has. No new UI and no engine work until Stage 1 is shown to work.
2. **Keep the routine pipeline green and honest.** `tests-ok` green at the tip, the gates in
   [AGENTS.md](AGENTS.md) applied as written, and the daily release published.
3. **Security debt first** among ordinary work: [#9](https://github.com/ThinkFlowLab/FlyBot/issues/9)
   → [#10](https://github.com/ThinkFlowLab/FlyBot/issues/10) →
   [#8](https://github.com/ThinkFlowLab/FlyBot/issues/8).
4. **Lessons become standards.** A failure seen three times is dated in
   [LESSONS.md](LESSONS.md); after at least three days the durable rule is promoted into
   [docs/code-standards.md](docs/code-standards.md) or [AGENTS.md](AGENTS.md).

## Stage 1 — active

**Objective:** prove project governance and decisions with existing Bots, Tasks, groups and GitHub,
before rebuilding the interface or the engine.

| Slice | State | Where |
| --- | --- | --- |
| Publish the minimal Project State (`PROJECT.md`, `ROADMAP.md`, `docs/governance.md`, `decisions/`) | **delivered by [#1680](https://github.com/ThinkFlowLab/FlyBot/issues/1680)** | this page, [PROJECT.md](PROJECT.md), [docs/governance.md](docs/governance.md), [decisions/](decisions/README.md) |
| Chief's severity triage and escalation, in operational wording | open — next | [docs/governance.md](docs/governance.md) describes the target; Chief's routing text and the escalation template are still to be written |
| A recorded disagreement / reclassification case | **recorded by [#1690](https://github.com/ThinkFlowLab/FlyBot/issues/1690)** | [decisions/2026-10-29-stage-1-dogfood.md](decisions/2026-10-29-stage-1-dogfood.md): Triage set `needs-human` on [#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550) on 2026-10-28; the owner reclassified it on 2026-10-29 and the label came off |
| A recorded major decision taken end-to-end: proposal → Chief classification → maintainer discussion and consensus → archived decision → executable issues | partly demonstrated by [#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550) itself | [#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550), [decisions/2026-10-29-stage-1-approved.md](decisions/2026-10-29-stage-1-approved.md) |
| Capture what Chief could automate and what still needed a human | open | to be written into the Stage 1 close-out record |

**Stage 1 acceptance (from [#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550)):** use a real
major design issue to demonstrate proposal → classification and research → maintainer discussion and
consensus → archived decision → executable issues, including a disagreement or reclassification case.
No pull request for the architecture proposal itself before authorization.

## Stages 2–5 — plan of record, not started

| Stage | Objective | State |
| --- | --- | --- |
| **2. Project as the work and knowledge boundary** | one unified Project view without duplicating task stores; role-aware owner/maintainer/member views; a shared Project State reader; a limited user–project assistant identity | not started; no code |
| **3. Handoff-controlled Workflow and isolated pool workers** | agree the typed Task/Handoff contract; role pools, ephemeral isolated workers, quotas, lease and recovery; strict DAG stays an option | not started; contract not agreed |
| **4. Chief meetings and Project Assistants in live collaboration** | temporary AI/human meetings for unresolved issues, archived decisions with dissent, personalized daily digests | not started |
| **5. RSI / autonomous project evolution** | research placeholder only | **gated**. No development, no agent-queue assignment and no performance claim until a separate proposal defines the optimization objects, evaluation criteria, safety boundaries, experiments and measurable acceptance tests |

Stages 2–4 are implementation direction, not approved work items: each stage becomes work only when
the owner approves its scope and it is split into reviewable issues. Stage 5's gate is unchanged by
Stage 1's approval.

## Not doing now

- No complete new UI for a Project console, and no rewrite of the existing DAG engine.
- No second task board and no new scheduler; existing boards, groups and GitHub stay the only
  stores.
- No knowledge-graph or vector-memory platform.
- No autonomous change of the mission, and no unreviewed expansion of Bot privileges.
- No change to `AGENTS.md` as part of a roadmap edit: the operating contract is linked, not copied
  here.

## How this roadmap changes

Editing this page is a **major** decision: the owner or a human maintainer concludes it, and the
outcome is recorded in [`decisions/`](decisions/README.md) with its evidence, participants and
dissent. A stage moving from "not started" to "active" is itself a decision, not an edit alone.
