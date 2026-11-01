# Repair native collaboration and use Bot task pools with handoff

Date: 2026-11-01 (Asia/Shanghai). Class: major. Status: accepted scope; implementation and acceptance are separate.

The fork owner authorized sequential implementation of [#33](https://github.com/zy95-12/FlyBot/issues/33), issues #34–#41, one implementation PR per issue, with repository memory, matching architecture and tests. The first repair PR stacks on the fetched M7 integration branch because main still contains only M0; subsequent dependent branches identify their actual parent explicitly. This is not permission to merge or weaken review gates.

Reuse the original rich chat, multi-Bot interaction and Project-scoped adaptations. Each logical Bot owns its task pool and may accept, return or transfer work. Normal downstream handoff goes directly to the receiving pool. Completion or uncertainty goes to Chief for judgement; fixed DAG is an optional template, not the default dispatcher. Conversation handoffs do not create Tasks. Code changes, adopted technical decisions, merges and releases use corresponding Task contracts.

Restore the effective Dev/Reviewer/Tester development and verification conventions, with versioned sources and actual evidence. Safe personal-agent mode asks before publishing impactful Tasks; watch mode acts with the user's full current authority, revocable and audited. Current account/Project/resource authority and existing repository gates continue to apply.

Chief inspection is a configurable scheduled task using FlyBot schedules. A project template may default to 30 minutes; cadence, content, thresholds and enable/disable are configuration. Do not hardcode a Chief-specific 30-minute framework loop. Schedule targets a durable logical Chief/Project, not a temporary SDK Session.

Public URL/domain/TLS/tunnel work is explicitly deferred. Keep control-plane unchanged. Preserve current Task/Attempt and failed-session evidence. Do not treat smoke checks or mock SDK/clock results as actual shared-service acceptance. No production change or automatic timer registration follows from this document.

R2 records complete versioned policy separately from bounded context previews and
assembles it after Workflow transformations for native and SDK execution. Its
branch stacks on R1 `acc4e929c70650eab88b65f69ca72fce81ebc99c`. Role guidance
never adds authority; structured candidate approval cannot manufacture a signed
forge review. After backend repairs, the owner authorizes assigning subsequent
fixes through the real FlyBot service to exercise role handoffs and Chief fallback.
This is distinct from authorizing merges or deferring failed acceptance.

R3 stacks on R2 `a1bf2ad899c164d5604c047595391f7563059a97`. New Project
deliveries use per-Bot pools by default and reuse existing Task, Attempt, Run,
Workspace, Session, resource leases and Workflow lifecycle/validator. Static DAG
execution remains explicit opt-in. No framework Chief inspection timer is added.
R4 supplies conversation bridging and R6 supplies Chief arbitration/schedules;
real-service acceptance remains required after those dependencies.

R4 adds conversation handoffs rather than a Task subtype for inquiries. A Chief
query receives only the explicit question plus shared facts, and returns to the
originating private conversation. The host prohibits Task/run effects in query
turns. Shared GitHub reads use explicit Project automation identity; personal
reads select the exact human/Project profile. Publication and execution status
are separate facts. Safe/watch persistence remains R5 scope.

R5 stacks on R4 `325dfc9bd5bf9f51597bd2344b6771db6822f0aa`. Safe mode
requires Task publication approval; watch delegates the current human's scoped
Project operations without additional agent-only approval. Browser sessions are
not durable grants. Current unchanged-platform account checks use an explicitly
configured FlyBot-owned read-only principal projection in the SQLite deployment;
no broad admin credential or control-plane source change is introduced.

Written-by: Codex

R6 stacks on R5 `5ce90bf89bb192ac445c2afa14eec6c3456ca829`. Chief receives
completion/uncertainty and proposes bounded evidence-gated effects using the
explicit configuring human's current Project authority. Original DSH schedules
provide cadence; a logical mapping supplies durable Project/Chief targeting and
occurrence deduplication. Default configuration lives in JSON, not a framework
clock. Supervisor-backed local restart proof does not weaken unknown-exit holds.

Actual SDK sandbox debugging established that CLI raw network denial also denies
Unix pipe lifecycle syscalls needed by Node. Preserve the external-access boundary
with a mandatory limited proxy and an empty domain allowlist, plus named scoped
filesystem permissions. Actual probe children run while proxied/direct outbound
and outside-workspace writes fail. This changes process IPC handling, not provider,
credentials, Project authority, public hosting or control-plane.

Actual Chief recovery exhausted a lifetime Chief→Dev edge budget despite a newly
verified environment repair. Apply the loop budget between audited Chief interventions,
keep global quotas and history, and preflight routing before changing execution state.
This permits explicit Chief recovery without granting ordinary workers a budget bypass.

Real Reviewer temporary-fixture failures require an explicit worker-owned scratch
grant and host-prepared dependencies while the review checkout remains read-only.
Use the existing resource and confirmed-exit lifecycle for provisioning/cleanup;
retry the same candidate and preserve prior INC evidence.

Preserve fully released, tested Chief-wait checkpoints across controlled backend
updates, with explicit restart audit and unchanged candidate/test evidence. This
exception excludes active claims, unknown exits, native workers and cancellation.

Existing owner scope requires one PR per issue through rework. The host delivery
repair in R6 preserves the same Task's PR binding and published candidate ancestry
across successor Attempts; independent worktree branch names are not remote PR
identity. Verified fast-forward continuation does not grant merge authority,
force-push rights, a new baseline or permission to attach unrelated Tasks.

Existing PR maintenance must retain both published candidate history and trusted
upstream integration. Host-derived target refs, registered commit availability,
resolved Git merge evidence and dual-ancestor publication gates implement this
without granting model authority to choose parents or bypass Test/Review. No
runtime-policy, model/resource, control-plane or merge authority changes follow.

Context repair retains the 48,000-character boundary and complete separately injected policy. Repository previews become source references only when full policy/source hashes, commit and preview prefix agree. A host-rejected admission with no registered execution can be checkpointed after proven Chief exit; bound or unknown resources cannot qualify. No runtime-policy or task-state bypass is authorized.

A Chief route keeps the existing unstarted Attempt. Host preparation may refresh its stale trusted upstream only after authenticated original-PR/head/ref checks, provisioned object/descendant proof and absence of registered execution with all leases released. Old/new bindings and claim generation are audited; no manual live-state edit, new Attempt, workspace reset or relaxed publisher check is an alternative. Owner feedback that the UI still looks old remains an explicit #40 residual requiring demo comparison and real interaction evidence.
