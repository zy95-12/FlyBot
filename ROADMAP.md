# FlyBot — Roadmap

## Active fork roadmap — 2026-10-31

Current execution order (Owner, 2026-11-01): repair and verify backend directly in
the foreground session, then resume the existing #40 Task/PR48 through FlyBot.
Do not use FlyBot to assign backend repairs. R6 recovery covers serialized wake
bursts, immediate persisted handoff/Chief events, original-requester queue recovery
and receiving-workspace preparation before inference and host testing. Remaining
live integration, frontend restoration and R8 acceptance retain their existing
issues; no passing unit suite alone completes them.


The owner-approved plan is [fork #1](https://github.com/zy95-12/FlyBot/issues/1), recorded
in [the fork decision](decisions/2026-10-31-project-first-fork.md). Historical upstream
stages below do not restrict the fork's approved Project and frontend refactor.

| Milestone | Deliverable | Status / issue |
| --- | --- | --- |
| M0 | Isolated DSH/tool/cwd/lifecycle and unchanged-platform HTTP checks | Merged PR #9; [#2](https://github.com/zy95-12/FlyBot/issues/2) |
| M1 | Project domain and direct Task/Run/Workspace ownership | PR #10 verified locally, awaiting review; [#3](https://github.com/zy95-12/FlyBot/issues/3) |
| M2 | Shared membership, platform identity adapter and backend authorization | PR #11 verified locally, awaiting review; [#4](https://github.com/zy95-12/FlyBot/issues/4) |
| M3 | Worktree, code/tests/PR/review evidence and human acceptance | PR #13 locally verified; integrated real-provider acceptance passed in M6; [#5](https://github.com/zy95-12/FlyBot/issues/5) |
| M4 | Public project Bots and private user/project agents | PR #14 verified locally, awaiting review; [#6](https://github.com/zy95-12/FlyBot/issues/6) |
| M5 | Rebuild task navigation, Project board, details and resource view | PR #15 locally verified, awaiting review; [#7](https://github.com/zy95-12/FlyBot/issues/7) |
| M6 | Repeatable two-user end-to-end acceptance | PR #16: real-model/GitHub/browser acceptance passed; awaiting review; [#8](https://github.com/zy95-12/FlyBot/issues/8) |

The owner authorized sequential M1–M6 implementation, one PR per milestone. Each PR
updates long-term memory, architecture and tests. Merge status is tracked separately.

Reuse platform services unchanged first; new project logic/adapters belong in FlyBot.
M0's deterministic model and existing shared-write denials do not imply M2/M3 completion.
GPU pools, multi-host scheduling, auto-merge and exact crash resume remain deferred.
The 30–43 person-day estimate is provisional pending interfaces/frontend design.

## Authorized M7 sequence

| Phase | Deliverable | State |
| --- | --- | --- |
| [M7.1 #21](https://github.com/zy95-12/FlyBot/issues/21) | Durable Chief/role memory and temporary Session snapshots | PR #26; full verify and actual DSH context checks passed |
| [M7.2 #22](https://github.com/zy95-12/FlyBot/issues/22) | Execution resource registry, candidate pools and leases | PR #27; full verify + actual local/Docker probe; integration #30 |
| [M7.3 #23](https://github.com/zy95-12/FlyBot/issues/23) | Native/Codex/Claude Agent SDK adapters | Draft PR #28; full verify passed; real authorization acceptance pending |
| [M7.4 #24](https://github.com/zy95-12/FlyBot/issues/24) | Owner configuration, probes and authorized resource terminal | Draft PR #29; full verify + actual PTY checks; browser integration #30 |
| [M7.5 #25](https://github.com/zy95-12/FlyBot/issues/25) | Cross-resource code/evidence transfer and real browser acceptance | Draft PR #30; code/resource/browser checks implemented, authenticated mixed-Harness acceptance pending |

User explicitly authorized sequential implementation and a separate PR for every issue,
including long-term memory, architecture and tests. Merge/deployment is separate.

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


### M7.2 — 2026-10-31

M7.1 PR #26 passed full verify and actual DSH context/lifecycle checks. M7.2 implementation on feat/m7-resource-pools adds resource capabilities/leases and real local+Docker execution probes; integration acceptance with SDKs remains in M7.5.


### M7.3 checkpoint — 2026-10-31

M7.2 PR #27 passed full verify and the opt-in actual local/Docker resource probe. M7.3 adapters are in progress; the implementation PR remains draft until remaining integration and real authorized SDK acceptance are complete; Chief now uses a host-validated scoped action bridge.


### M7.4 — 2026-10-31

M7.3 PR #28 passed full verify at 034d86c, remains draft pending authenticated acceptance. M7.4 implementation supplies Owner runtime configuration/probes/private PTY and strengthens positive worker-stop confirmation; M7.5 cross-resource delivery and final acceptance remain next.


### M7.5 — 2026-10-31

M7 implementation PRs: #26 role Sessions, #27 resource pools, #28 official SDK Harnesses, #29 Owner setup, #30 handoff/integration. Full verify passed #26–#29 tips; final #30 validation/report is recorded in its PR. Real authenticated SDK/browser mixed-resource acceptance remains pending dedicated authorized profiles; M8 continuous CI/review and M9 persistent dogfood operations remain later work.

### M7 validation update — 2026-11-01

Owner requested Codex-only real acceptance on the current machine using zy95-12 GitHub.
Run the opt-in dedicated-profile SDK/Workflow/PR/return/retry/acceptance path and record
its exact source SHA. Do not block this scoped demonstration on Claude configuration;
keep the broader mixed-Harness/two-resource criteria explicitly outstanding.

Codex-only local demonstration: passed at `73161f3`; real artifact PR #31 returned,
#32 re-tested/re-reviewed and script-accepted at its exact SHA. No merge/deployment.
Broader Claude/mixed-resource/browser-auth/restart checks remain separate future work.

## Owner-authorized collaboration repairs — 2026-11-01

[Tracking #33](https://github.com/zy95-12/FlyBot/issues/33): #34 repository preflight → #35 role contracts → #36 per-Bot pools/handoff → #37 ordinary Chief queries → #38 safe/watch delegation → #39 Chief arbitration/configurable schedules → #40 native UI/multi-Bot reuse → #41 actual shared-service acceptance. Component/UI inventory may proceed alongside its foundations; each implementation has its own PR and tested evidence. Public hosting is deferred. A 30-minute Chief inspection is a configurable scheduled-task default, never framework logic. R1 PR #42 passed full local verification; configured-service acceptance is pending. R2 implements complete role-policy delivery and evidence separation and is under verification. R3 dynamic pool/claim/handoff implementation is under verification, including non-DAG SDK contract-process rework. R4 conversation/query/status repair is under verification; R5 persistent safe/watch delegation is under verification; R6–R8 remain pending; R4 integrates conversation bridging and R6 completes Chief arbitration/configurable schedules. The owner requests backend repairs first, then real human-style assignment through FlyBot to exercise role handoffs and Chief fallback.

R6 implementation checkpoint: Chief now adjudicates completion/uncertainty and may
intervene through audited routes. Inspection reuses original configurable DSH
schedules; there is no Chief cadence in framework timers. After exact-tip full
verification and its own draft PR, upgrade the backed-up shared backend, assign
#40 through actual FlyBot and collect real Codex/handoff/Chief/restart evidence in
#41. Protocol fixtures alone do not satisfy those integration criteria.

R6 real-service integration now exercises ordinary Chief queries without Tasks,
original scheduled wake after logout, editable pause/resume and actual Dev→Chief
return on one Task. Dogfood exposed HTTP registration, release/reconcile race and
failed-admission status defects; fixes remain in R6 PR #47 with regressions. R7
completion and all remaining #41 acceptance are still pending.

R7 #40 candidate restores Project-scoped internal role rooms, mention/member routing,
registered text artifacts, native public streaming and readable pool/Timeline views.
See [inventory and limits](docs/subsystems/project-collaboration.md) and the
[implementation decision](decisions/2026-11-01-r7-native-collaboration.md).
The deterministic service/DOM checks do not satisfy criterion 7. Chromium/backend is
blocked by this worker's loopback-listen policy; operator deployed three-role acceptance
and Chief overall judgement remain pending. No Task is closed by this checkpoint.

R7 rework preserves the existing candidate and failed Attempt. The reported core
registration failure and browser fixture authentication mismatch have local red/green
evidence; full host verification and actual deployed three-role acceptance remain gates.


R7 rework adds socket-free complete workbench bootstrap/agent initialization checks and repairs the release-fragment format found in the current full verification log. This does not establish Chromium or deployed-service acceptance; Tester must run the configured host gate and the operator must rerun browser clicks.
R6 actual persistent 30-minute wake and restart-preserved cadence passed on source
59635b2. Shared issue #40 code delivery is still exercising SDK Git permissions
and handoff preparation; final role-chain/browser acceptance remains incomplete.

R6 real recovery exposed an exhausted lifetime Chief→Dev edge and partial routing
mutation. Regression coverage now checks bounded epochs after audited intervention,
unchanged admission on refusal, preserved quotas and recoverable preparation failure.
R7 remains unsealed until actual Developer completion and downstream evidence.

R7 real Dev→Tester→Reviewer handoff reached a host-verified candidate and passing
Chromium fixture. Reviewer truthfully returned INC for sandbox temporary writes.
R6 repairs host-bound scratch allocation, explicit permissions and exit-gated cleanup;
retry independent Review at the same candidate after environment preparation.

R6 restart recovery now distinguishes a fully released, tested Chief-wait checkpoint
from active or unknown execution, so environment upgrades can retry Review at the
same candidate without manufacturing a new implementation Attempt.

Current same-PR maintenance blocker: fix host publication continuation in R6 PR47,
validate against a real local Git remote and mocked forge, then deploy only after
current checks. Chief may then judge PR48 conflict rework on the same Task/PR.
The #41 Task remains execution-blocked until its registered baseline includes R6+R7;
no duplicate PR or runtime-policy change substitutes for that prerequisite.

The remaining upstream-sealing blocker now has real Git red/green coverage: retain
both published and trusted target ancestry after resolved conflicts, not just the
old seed. Verify this backend head, integrate/deploy it without altering live
Attempts, then let Chief decide same-PR48 maintenance. #41 remains baseline-held.

Context admission repair is source-tested on the existing PR47 branch. Deploy only after exact-head verification and actual-state recovery proof; then reconcile the reserved lease and let Chief judge routing the same Attempt. This does not select the #41 execution baseline or waive failed M6 CI.

The same-Attempt target-refresh host repair needs exact-head verification and integration/deployment before Chief routes the existing #40 Task. Owner UI feedback remains unaccepted work on #40/PR48: match the original polished demo and native FlyBot interactions using real API state; functional browser checks alone do not establish visual acceptance.

P0 now includes the reproduced M6 fixture/contract mismatch: complete actual safe-mode approval in browser and preserve negative authorization/duplicate checks, then assess current-head CI. Target refresh166 is integrated/deployed independently; UI remains unaccepted and P1 efficiency work remains queued until its real path is executed.

R7 visual rework follows the owner's demo-first priority: conversation-focused shell,
separate Settings, and expandable Task reading hierarchy on original Task40/PR48.
No new backend authorization or framework optimization is bundled. New-candidate
host tests, independent Review and desktop/narrow-screen visual/live acceptance
remain required; the inherited candidate's evidence is not reused as a new PASS.

Chief inspection may explicitly select one existing Task in its authorized Project. The host validates Project configuration authority and Task ownership before using the existing scoped snapshot mechanism. Other-Project/missing Tasks are rejected; unscoped inspection is unchanged. This reduces unrelated facts without dropping policy/knowledge or raising context limits.

Owner basic-CI policy is implemented on the existing PR47 local branch: default pinned install/lint/build/canonical/core and plugin unit checks; heavy browser/runtime/package checks explicit extended dispatch. Independent Review and actual UI acceptance remain. Publish only at a safe upstream-binding checkpoint; this local change does not claim live workflow activation.

R7 continuation implements non-overlapping polling, page-specific reads and summary projections, public Bot inspection and the Settings locator repair. Native personal-space compatibility, current-source browser throttling and actual deployed visual acceptance remain outstanding on #40/PR48; no completion or acceptance is claimed.


R7 returned-candidate repair: workflow contract tests now match the authorized basic/extended split and executable result gate. This repairs the two observed host failures at 653ebc2; it does not complete native personal-space compatibility or actual UI acceptance.

#40 native conversation slice: original Bubbles/identity marks are mounted in Project
Chief/private chats; sessions/uiConversation/slots, personal-space/native-group
compatibility and versioned desktop/narrow visual acceptance remain outstanding.


R7 native conversation continuation: connect scoped observable history to Chief/private/room rendering and concurrent role streams. Personal space and sessions/uiConversation/slots integration remain the next required implementation slice; no overall completion or visual acceptance is recorded.

R7 native continuation: preserved original personal Chief/Bot/group entry now has
bounded identity/history/send/own-memory adapters and original AssistantCell reuse.
Full native shell sessions/slots/composer and tool/approval integration, screenshots
and deployed acceptance remain outstanding; component tests do not close #40.

R7 Attempt8a: bounded diagnostics now reproduce and clear all five whitespace
findings through source generators; 36 focused regressions pass. This is partial
unsealed implementation progress, not full native compatibility or UI acceptance.

#40 continuation recovers the preserved draft and pinned upstream together; adds
native personal tree controls. Full native composer/tool/approval parity and actual
candidate screenshots/service acceptance remain explicit remaining work.

R7 returned-candidate follow-up adds scoped personal-history pagination with
refresh retention and late-page privacy regressions. Same Task/PR lineage remains;
this local repair does not establish deployed UI acceptance.

Current frontend recovery blocker: shared operational history exceeded role context
admission. R6 adds explicit manager-published knowledge checkpoints preserving all
source records; test and deploy the current projection, publish an authorized concise
checkpoint, then restore the same086 Attempt through scoped Chief judgement. Original
PR48/native styles/composer/legacy interactions remain accepted frontend work.

#40 continuation integrates pinned backend b3a1a6ed without discarding native UI changes. Same-origin native CSS and immediate logout isolation are the current verification slice. Native composer/tool/approval/stop integration and real three-account/weak-network screenshots remain required before Chief completion.

R6 follow-up from real UI64 return: supply exact-source failed-test diagnostics
to the next role so a hash-only Chief return does not require manual log hunting.
Keep independent full logs, redaction, same-Task/SHA checks and bounded excerpts.

#40 continuation integrates pinned backend 45b499bf without discarding the candidate CSS/logout slice. Popup layering verification follows the extracted canonical stylesheet. Native composer/tool/approval parity and actual three-account/weak-network screenshots remain open; host verification and independent review are still required.


Task #40 rework: the inherited candidate failed the fragment validator because
`40.fixed.md` contained multiple paragraphs. Keep one entry per fragment. The
native conversation script now uses production React configuration and full
minification, guarded by a 4.6 MB script budget (previous asset: 5.37 MB). This
is a bounded reduction, not completed weak-network acceptance: embedded math
fonts/CSS and the full native composer, tools, approval, stop/continue and
personal/group interaction integration still require work. Operator deployment,
three-account browser checks and actual screenshots remain pending.

Task40 font-loading repair reduces initial native CSS to 217104 bytes and preserves
self-only CSP. It does not complete rich native interaction or real three-account
acceptance. Continue composer, tool/approval, stop/continue and weak-network validation
after independent host checks of this candidate.


### Resident Chief and Task-role context — 2026-11-01
Implemented Task-role logical identity, binding-checked SDK resume across rework, retained cwd ownership/cleanup and current candidate inputs. Added original-store Chief topic-memory read/write/replace and same-thread scoped retrieval rounds, plus immutable context archives instead of re-sending unbounded history. Native DSH keeps its original parts/steward/compaction; SDK uses its own runtime compaction. Verification must include real resource-user/runtime continuation and Chief memory before claiming live delivery. Current native workflow carriers remain per execution; their logical Task identity and retrievable facts are retained, not falsely described as SDK backend threads.

Task40 continues with synchronized native CSS/JS loading and a scoped composer
exported from the original composer module, sharing dictation cleanup and captured
chat sends. Focused regression evidence is separate from complete UI acceptance;
rich tool/approval, personal running state and deployed browser acceptance remain open.
