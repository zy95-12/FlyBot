# FlyBot — Project State

The single page that says what this project is, who decides what, and what automation must never
do. Operational rules live in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md);
architecture lives in [docs/architecture.md](docs/architecture.md) and
[docs/subsystems/](docs/subsystems/README.md). This page links them and does not repeat them.

Current stage and priorities: [ROADMAP.md](ROADMAP.md). How decisions are made:
[docs/governance.md](docs/governance.md). Dated decisions: [decisions/](decisions/README.md).

## Fork Project State — 2026-10-31

This is `zy95-12/FlyBot`. Current scope is the [shared-project roadmap](https://github.com/zy95-12/FlyBot/issues/1)
and [fork decision](decisions/2026-10-31-project-first-fork.md). The inherited mission,
people and stage descriptions below are historical upstream context; upstream accounts
are not this fork's decision-makers merely because inherited docs name them.

- Project is the target stable boundary for Task/Run/Workspace ownership. Bots and
  Sessions are replaceable execution/interaction carriers. M1 implements direct ownership and explicit legacy resolution; see [Project domain](docs/subsystems/project-domain.md).
- Reuse control-plane identity, auth, invitation, instance and operations APIs unchanged
  where possible. Put project business logic/adapters in FlyBot; justify a missing API
  separately. The platform PR was withdrawn, not merged.
- Rebuild task navigation and the Project board; current UI/components are not constraints.
- M0 is implemented on [PR #9](https://github.com/zy95-12/FlyBot/pull/9), merged (2026-10-31):
  real DSH/tool execution with a deterministic model, plus a FlyBot-owned HTTP adapter
  exercising unchanged external platform source. This is not real-model PR delivery.
- The baseline identity, scoped Workflow-write and per-run cwd seams are implemented
  through M1–M3; later milestone integration and live acceptance are recorded below.
- Durable repository memory is this page, ROADMAP, LESSONS and dated decisions. Update
  them and matching architecture docs alongside code, with regression coverage in
  verify/CI and tested-SHA evidence. Never edit live DSH/Bot memory for repository decisions.

See [baseline ownership and tests](docs/subsystems/demo-baseline.md).

- M1 implementation ([PR #10](https://github.com/zy95-12/FlyBot/pull/10), complete local verification, awaiting review) adds Project service/policy/repository boundaries, immutable work
  ownership, explicit migration, archive/delete/member-removal rules and an owner-only
  detail API. Workspace records are directory references; M3 supplies worktree isolation.
- The owner authorized continuing M2–M6, one PR per milestone, with memory, architecture
  and tests updated in each. [M1 decision](decisions/2026-10-31-m1-project-ownership.md).

- M2 ([PR #11](https://github.com/zy95-12/FlyBot/pull/11), complete local verification, awaiting review) implements the [shared access contract](docs/subsystems/project-access.md): unchanged
  platform auth API adapter, stable subject mapping, human membership policy/invites,
  immediate revocation and scoped Workflow gateway. It is explicitly configured; worktrees,
  agent delegation/credentials and browser delivery are supplied by M3–M6 below.

- M3 ([PR #13](https://github.com/zy95-12/FlyBot/pull/13), full local verify) implements the [commit-specific delivery contract](docs/subsystems/project-delivery.md)
  on the existing Workflow service: versioned Attempts, real role worktrees/cwd, host test
  evidence, Review/SHA gates and human acceptance. Actual DSH and draft artifact PR #12
  were first exercised with a deterministic model. Integrated real-model/GitHub/browser
  acceptance subsequently passed in M6; [evidence](docs/live-acceptance.md).

- M4 implements [scoped Project agents](docs/subsystems/project-agents.md): fresh public
  Chief, private human/Project identities, separate memory/history/proposals, live delegated
  tool checks, role/skill snapshots and exact GitHub credential scopes. Actual DSH fixture
  validation covers creation/publication/revocation; real-model/browser acceptance
  subsequently passed in M6. Runtime code-worker OS isolation is not claimed by this demo.

- M7 is owner-authorized in [#20](https://github.com/zy95-12/FlyBot/issues/20),
  implemented sequentially as #21–#25, one PR per issue. It explicitly authorizes native,
  Codex SDK and Claude Agent SDK Harness choices; the inherited upstream removal of
  Codex does not govern this fork. Control-plane remains unchanged. M7.1 introduces
  explicit public role memory and bounded hashed execution contexts, durable Chief
  identity/history and per-Attempt temporary Session bindings. M7.2–M7.5 code is on PRs #27–#30: resource leases, SDK Harnesses, Owner setup and
  verified Git handoffs. Authenticated mixed-resource acceptance remains outstanding;
  the later owner-authorized local Codex-only run passed, as recorded below.

## Historical upstream Project State

## Mission

FlyBot is a local team of long-lived AI Bots that runs on DeepSeek Harness (DSH), in your own
browser, with your own model keys. One person talks to one Bot — the **Chief** — and the team takes
the request apart and comes back with one answer. The Bots keep their own memory, working folder,
model and schedules between turns, so work outlives a single chat.

The project's mission is to keep that team reliable and inspectable: every Bot acts on evidence,
stays inside its goal, and its result can be checked by a person afterwards. The product is the app
in this repository plus the patches that pin it to upstream `ds-bot`; it is not a hosting service.

`AGENTS.md` states the two halves the code is built from: pristine upstream `ds-bot/` (never edited),
and `core/` — `ds-bot/` plus FlyBot's ordered patches — which is what ships and what the tests run.
The shipped features are the DSH plugin in `core/` and the peer plugins `plugins/social`,
`plugins/tree`, `plugins/timeline` and `plugins/workflow`.

## Owner and maintainer roles

Today the project has one owner and a small number of human maintainers; the Bots work under the
owner's delegation. This is the state of the repository as of 2026-10-29, not the target model of
[#1550](https://github.com/ThinkFlowLab/FlyBot/issues/1550).

| Role | Who | Decides |
| --- | --- | --- |
| **Owner** | Danyang, GitHub [`Birfy`](https://github.com/Birfy) (repository admin) | Mission, governance policy, roles and membership, project Bots, compute and resources, budgets, autonomy boundaries, and every matter reserved to the owner in [docs/governance.md](docs/governance.md) |
| **Maintainer** (human) | People with repository write access — today the owner and [`hsliuustc0106`](https://github.com/hsliuustc0106) | Major decisions under [docs/governance.md](docs/governance.md): roadmap and architecture changes, changes to the governing documents, multi-subsystem contracts. Records a verdict through the review policy, never through an admin merge |
| **Chief** (AI) | The owner's Main Bot, writing as `Birfy` | Plans and routes work, splits a request into role tasks, **classifies** each decision as ordinary / major / severe with its rationale, convenes a discussion when one is needed, and escalates to the owner. Not the ultimate authority and not the owner |
| **Routine Bots** (AI) | `Triage`, `Dev`, `Dev2`–`Dev4`, `Reviewer`, `Reviewer2`, `Release`, `SelfTest`, `Docs`, `Maintainer` — the names in [`writers`](.github/agent/review-policy.json) | Only their routine's job: see [Routines](AGENTS.md#routines). A Bot records a conclusion only where its routine owns that conclusion, and the implementer never writes the verdict on its own change |
| **Contributors** (human) | Anyone who opens an issue or a pull request | Proposals, bug reports, code. No default approval right; a contribution merges only through the gates in [AGENTS.md](AGENTS.md) |

Deliberately **not** claimed here, because it is not shipped: a Maintainer console, a Member role, a
Project Assistant, per-person GitHub attribution for Bots, and the multi-human authority contract in
[docs/subsystems/team.md](docs/subsystems/team.md) (planned; team mode stays disabled until its
authorization gates pass). Every Bot still writes as the one shared `Birfy` identity, so a
`Written-by:` line is a claim the gates can check for presence and name, not a signature.

## Resources covered

- **This repository** — `https://github.com/ThinkFlowLab/FlyBot`, the source of record. `main` is
  the live branch; pull requests merge into it only through the merge queue.
- **Code** — `core/` (shipped plugin, source of truth), `patches/ds-bot/` and `core/client.js`
  (generated from `core/`), `plugins/*` (peer plugins), `scripts/` and `core/scripts/`.
- **Rules and knowledge** — `AGENTS.md` (operating contract), `CONTRIBUTING.md`, `LESSONS.md`
  (observed failures and promotion to standards), `docs/` (architecture, standards, runbooks),
  `decisions/` (dated decisions), `PROJECT.md` and `ROADMAP.md` (this page and the plan).
- **Automation** — `.github/workflows/` and `.github/scripts/` (CI, risk tier, review gate, merge
  gate, enqueue guard), `.github/agent/` (risk rules and the review policy).
- **Authoritative runtime state elsewhere** — GitHub issues, pull requests and CI runs are the
  authority for work state; task boards, approvals and per-Bot memory live in FlyBot's own storage,
  never in this repository. `docs/` pages are informative only where a source above decides
  something.
- **Not in this repository** — the upstream `ds-bot` project (pinned in `ds-bot.pin.json`, read-only
  here) and the self-hosted Bot Social server used by the social plugin. The fork
  `Birfy/FlyBot` is an archive: nothing merges into it.

## Governing boundaries

Who decides what is written in [docs/governance.md](docs/governance.md), in the operational wording
this repository uses today. In short:

- **The owner** decides the mission, the governance policy, the roles and their membership, the
  autonomy boundaries, the security surface, and any matter reserved in that page.
- **A human maintainer** concludes major decisions, records a verdict, and can challenge any
  classification.
- **Chief** classifies decisions, routes work, records outcomes, and escalates what it may not
  conclude. A classification is a routing label, never an authorization.
- **A routine Bot** concludes only ordinary work inside its routine, through the gates in
  [AGENTS.md](AGENTS.md).

### What automation may never do

These hold for every Bot and every routine, whatever the CI state, the label or a chat message says:

1. **No production deploy** of Bot Social, and no change to the owner's own local instances, without
   the owner's explicit yes.
2. **No secrets** — never write, print, log or commit an API key, token, cookie or `DSH_HOME`
   contents. A withheld key is read from `DSH_SECRETS_WITHHELD` by name only.
3. **No touching the owner's DSH data** — never point a test or a run at `~/.dsh` or at a DSH the
   owner is using; the test bench keeps its own `.dsh-test-<name>/`.
4. **Never patch DSH** and never depend on files inside a DSH install. Build on the documented
   plugin APIs or stop and say what is missing.
5. **Never bypass a gate** — no admin merge, no force-push of `main`, no bypass of a required check,
   no change to a ruleset or to branch protection, and never remove a pull request the owner put in
   the merge queue.
6. **Never lift `hold`.** Only a person sets the label and only a person removes it.
7. **No version or changelog edits outside the release routine** — `CHANGELOG.md` and
   `core/package.json` belong to the daily release, not to a feature pull request.
8. **No issue on someone else's upstream**, and no design proposal filed as an issue: a proposal
   goes to the owner, who decides whether it becomes work.
9. **Never write a verdict on a change the same Bot implemented**, and never record a second
   conclusion at one tip to win a disagreement.
10. **Never edit another writer's text to change what it said** — a correction is a new comment, a
    new decision record or a `Correction from <Bot>:` line.

Changes to this page, to `ROADMAP.md`, to `docs/governance.md` or to `AGENTS.md` are **major**
decisions, concluded as [docs/governance.md](docs/governance.md) requires and recorded in
[`decisions/`](decisions/README.md).

- M5 implements the standalone shared Project workbench, restricted gateway, durable
  quota admission and actual acceptance/resource metrics. It reuses unchanged platform
  services and the existing Workflow executor. See [M5 decision](decisions/2026-10-31-m5-project-workbench.md).
  Browser/live-model acceptance is tracked separately in M6; no deployment is implied.

- M5 ([PR #15](https://github.com/zy95-12/FlyBot/pull/15), full local verify passed) supplies
  the actual shared Project UI/gateway and quota admission. M6 adds a clean two-account
  Chromium/DSH/platform runner and foreground demo launcher, plus the Project Chief
  dispatch fix found through that fresh entry. See [shared demo](docs/shared-demo.md) and
  [M6 decision](decisions/2026-10-31-m6-shared-demo.md). True-model full delivery acceptance
  subsequently passed; see the [live acceptance record](docs/live-acceptance.md). Earlier deterministic evidence remains separately labeled.

- The owner supplied an official DeepSeek credential for live validation. Official model
  catalog, inference and full live browser/GitHub acceptance passed at `f126f8c`.
  Credentials are process-only and are never repository memory. Integration fixes include
  model-visible JSON tool results, same-request Task/proposal deduplication, bounded unique
  carrier names, and propagation of human-return feedback into retry snapshots.

- Real-provider acceptance completed with two platform accounts, real role worktrees,
  independent host tests/Review and GitHub artifact PRs #18/#19, browser return/follow-up/accept,
  failing tests/retry/queue/revocation and cleanup. [Evidence](docs/live-acceptance.md) and
  [owner decision](decisions/2026-10-31-real-provider-acceptance.md). Implementation PR #16
  contains the integration fixes and regressions; review/CI/merge remain separate.


### M7.2 — 2026-10-31

M7.2 adds operator-granted local/Docker execution resources, safe environment observations, candidate pools, sticky resource leases and shared queue capacity accounting. The actual two-runtime probe passed with distinct hostnames/filesystems and confirmed cleanup. SDK authentication and mixed-resource Task delivery remain M7.3–M7.5. See docs/subsystems/project-resources.md.


### M7.3 checkpoint — 2026-10-31

M7.3 work in progress adds pinned official Codex/Claude Agent SDK temporary worker adapters through the existing Workflow seam, explicit per-resource/principal profiles, streamed evidence and exit-confirmed resource release. Chief SDK actions now use a host-validated scoped JSON bridge; cross-resource dispatch remains pending; no full real-SDK acceptance is claimed.


### M7.4 — 2026-10-31

M7.4 adds Owner role/persona/Skills/memory/Harness/model/multiple-resource configuration, bounded connection checks and explicitly granted private target-resource PTYs. Credentials stay in private profiles; generated profiles separate Project/principal/Harness. Actual local and new Docker PTYs, hidden setup, current-session revocation and background cleanup are tested. Real authenticated three-Harness acceptance remains pending dedicated credential/profile selection.


### M7.5 — 2026-10-31

M7.5 implements local/Docker Git workspace handoffs, SHA256 manifests, one final sealed candidate without intermediate worker history, independent host-verifier tests, same-SHA review and sealed SDK event evidence. Browser integration fixes runtime/terminal/input channel routing; callback-aware stop acknowledgement prevents release deadlock. See docs/m7-acceptance.md: positive authenticated three-Harness/two-resource PR acceptance still needs dedicated profiles, so M7 is not declared fully accepted.

### M7 Codex-only acceptance authorization — 2026-11-01

The owner authorized existing zy95-12 GitHub and Codex authentication on this machine
for real Codex validation. A private selected profile outside the repository is used;
no auth values, unrelated Codex history or connector configuration are copied into the
repository. The opt-in `--codex-check` exercises the native host/Workflow with real SDK
Chief/Dev/Tester/Reviewer and draft PR evidence. Claude and mixed-resource acceptance
remain separate. No merge or production deployment is authorized by this validation.

The scoped local Codex demonstration passed at clean source `73161f3`: actual Chief,
Dev/Tester/Reviewer, immutable tests, matching-SHA draft PRs #31/#32, requested-test
return/retry/re-review and scripted owner acceptance. Workers/workspaces were released.
[Evidence](dev/demo/evidence/codex-2026-11-01.json) distinguishes this from the outstanding
Claude/mixed-resource/browser/restart criteria and independent repository review.

### Collaboration repairs — 2026-11-01

The owner authorized sequential issues [#34–#41](https://github.com/zy95-12/FlyBot/issues/33), one PR each; see [decision](decisions/2026-11-01-collaboration-repair.md). The target is native multi-Bot reuse, per-Bot pools and enforced handoff, restored role contracts, ordinary Chief conversations, safe/watch delegation and configurable Chief inspection schedules. Public hosting is deferred; control-plane stays unchanged.

R1 (#34) rejects incomplete repository capabilities before workers/workspaces/leases are allocated. Workbench readiness checks Git/runtime/dependency metadata and reports the precise block; this does not claim tests or SDK task delivery have run. Old failed Attempts remain readable. R1 full local verification passed in PR #42; actual shared-service integration remains pending.

R2 (#35) restores complete Dev/Tester/Reviewer conventions, pinned policy-source hashes and final-execution prompt assembly for native and SDK roles. FlyBot code sealing requires memory/tests/architecture evidence; candidate approval explicitly cannot mint a signed forge PASS. Focused tests cover full rules reaching SDK input, required-source failures and tampering. R2 full verification and later backend/dogfood acceptance are tracked separately.


R3 (#36) implements per-logical-Bot pools on existing Task records, atomic claims,
versioned receipts and enforced handoff admission. New shared deliveries default
to dynamic pool dispatch; the legacy DAG is explicit opt-in. Only the receiving
role allocates an execution Session/resource. Candidate returns retain the Task
and create a new Attempt; overall completion waits for Chief judgement. Unit and
SDK contract-process tests cover non-DAG return/rework with one resource. Full
verification, conversation bridging, Chief arbitration/schedules and real shared
service dogfood remain separately tracked acceptance, not implied by these tests.


R4 (#37) adds conversation-only private → Chief → original-chat handoff, isolated
from private memory and other members. Query turns cannot publish or execute a
Task; scoped GitHub reads provide actual repository facts. Impactful Task kinds
persist across proposal publication; workbench status separates publication from
queue/start/execution and Chief wait. Targeted privacy, native/SDK-query, no-Task
and credential/revocation tests pass. Full verification and real shared-service
acceptance remain separate; control-plane and public hosting are unchanged.


R5 (#38) implements safe/private publication proposals and persistent, revocable
watch grants bound to the current human and Project. Browser logout does not
revoke watch authority; account/membership/grant changes do. Scoped actions use
current human rights and retain provenance. The unchanged SQLite platform can
supply fresh account status through a FlyBot-owned read-only operator helper,
without storing browser cookies or admin credentials. Regression tests cover
logout, restart, current rights, revocation, forged status evidence and fresh WAL
reads. Shared-service provisioning and real-model acceptance are still pending.

R6 (#39) adds evidence-gated Chief arbitration, audited intervention and configurable
inspection on original DSH scheduled tasks. The JSON template defaults to 30 minutes;
content, cadence, thresholds and pause/enable are editable. Current configured human
authority and generation fences apply to each effect. Unknown process exits retain
capacity; a verified systemd invocation boundary permits local restart recovery.
Deterministic protocol tests return incomplete coverage to Dev then close the same
Task after a fresh Attempt. Real shared-service Codex/timer acceptance remains #41.

Real shared-service R6 probes passed an actual Codex Chief ordinary inquiry with
zero Tasks and an original DSH 60-second wake after browser logout, then pause/
resume and restoration to 30 minutes. R7 actual Dev requested Chief arbitration;
Chief returned the same Task to Dev with a fresh Attempt. This exposed a concurrent
resource-release reconciliation race, fixed with a red/green regression. Actual
full R7 delivery and persistent 30-minute/restart acceptance remain in progress.

R7 dogfood also exposed sandbox Git-index and host-test boundary failures. Scoped
Codex writable roots support canonical generation; Chief route may resume a
running pre-candidate Attempt without discarding uncommitted work. Explicit
return or interrupted/candidate-backed work still creates a fresh Attempt. SDK
release records carry actual stop-ack/process-exit proof, not terminal Task inference.

The original DSH 1800-second schedule actually fired at 2026-10-31T21:54:39.260Z
after browser logout and multiple backend restarts; exactly one actual Codex
Chief Run completed. This proves the persistent 30-minute wake, not just a
shortened-clock fixture. Remaining shared delivery/browser acceptance is separate.

A real SDK sandbox/strace probe identified Unix pipe syscall denial as the remaining
Node/Git subprocess blocker. Command roles use a named filesystem profile and the
limited network proxy with no allowed destinations; Chief remains tool-free. Actual
probe children succeed while outbound requests and outside-workspace writes fail.

Chief recovery found a lifetime edge-budget refusal after several real environment
repairs. Audited Chief intervention now begins a fresh bounded autonomous routing
epoch while preserving full history and global quotas. Admission is checked before
claim fencing or Attempt preparation; later preparation failure is explicitly blocked.

Actual R7 candidate `56d14be` passed host full verification and complete deterministic
Chromium/backend clicks. Independent Review was blocked by read-only temporary
fixtures; command workers now bind a unique scratch directory and offline npm cache,
without granting review-source writes. Cleanup follows confirmed SDK exit. Actual
deployed three-account acceptance and independent approval remain separate.

A tested pool checkpoint waiting for Chief/human input survives host restart only
with a completed Chief Run and all registered SDK workers/leases confirmed released.
It retains the candidate and test receipt; active claims or unknown exits still
interrupt delivery. A checkpoint audit records the restart without inventing progress.

Published delivery rework now carries the host's existing PR binding through Chief
returns and human retries. Sealing keeps the old published candidate as an ancestor;
publication rechecks the original PR/head and fast-forwards its branch, refusing
concurrent/closed/mismatched artifacts rather than creating another PR. Actual
PR48 remains unchanged until verified backend deployment and Chief-directed rework.

Published rework now pins the actual GitHub target ref through the host broker.
A resolved merge seals with both the old candidate and trusted upstream parents;
roles receive that pinned input and publication rejects target movement or lost
ancestry. Merged content still requires real host tests and independent Review.

Role admission now replaces verified duplicate repository previews with complete-policy references, preserving full rules and all shared knowledge under the existing context cap. Preparation failures release unbound reservations and retain drafts; narrow host-proven rejected-admission checkpoints preserve the same Attempt across restart.

Unstarted bound delivery now revalidates the live PR target before Developer allocation and audits a descendant-only target refresh on the same Attempt, preserving the original PR, candidate seed and unsealed draft. Active, unknown or previously recorded execution cannot silently retarget.

Recurring M6 browser timeout reproduced at166: the native Chief correctly generated a safe-mode proposal, while the old fixture waited for an unapproved Task. Acceptance now verifies no early Task, cross-user rejection, explicit requester UI approval and idempotent publication before existing delivery checks; production authorization is unchanged.

Chief inspection may explicitly select one existing Task in its authorized Project. The host validates Project configuration authority and Task ownership before using the existing scoped snapshot mechanism. Other-Project/missing Tasks are rejected; unscoped inspection is unchanged. This reduces unrelated facts without dropping policy/knowledge or raising context limits.

Owner basic-CI policy is implemented on the existing PR47 local branch: default pinned install/lint/build/canonical/core and plugin unit checks; heavy browser/runtime/package checks explicit extended dispatch. Independent Review and actual UI acceptance remain. Publish only at a safe upstream-binding checkpoint; this local change does not claim live workflow activation.

- R6/#39 existing-PR publication recovery now has a manager-scoped endpoint that
  revalidates original sealed role/test evidence and uses the guarded publisher.
  It repairs read-after-push receipt gaps without a new Attempt, fabricated Review
  or overall Task acceptance; see Project delivery architecture and regressions.
- Chief resource context retains current/uncertain lease details and digests only
  proven released history, preserving original records and the 48k admission limit.
