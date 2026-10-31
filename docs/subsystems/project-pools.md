---
subsystem: project-pools
owned_paths:
  - core/src/host/project-pools.js
  - core/test/project-pools.test.js
---

# Per-Bot Project task pools and handoff

New shared deliveries default to `project-handoff/v1`, with
`project-delivery/pools-v1` Attempts. `projectDispatch: workflow` explicitly selects
the historical fixed DAG; saved v1–v4 Attempts are unchanged. The existing Workflow
plugin supplies worker lifecycle operations and its pure `validateHandoff`; a
missing adapter blocks admission rather than silently substituting a DAG.

## Identity, ownership and receipts

Each durable role definition has a stable logical Bot ID. Task.collaboration stores
its destination, current claim, generation, originating human, Task kind and receipt
history. There is no second Task database. `project-task-pools` lists each Bot's
available Tasks for a current Project member. Human permissions are checked at
admission and again at claim/result; a role label grants no human authority.

A receipt includes Project, Task, Attempt, logical from/to, reason, requirements,
policy protocol/definition revision, idempotency key, generation and lifecycle.
Pending receipts become accepted on atomic claim and retain the finished execution
record after transfer. Duplicate decisions have one effect; altered retries and
old claims are refused. Tasks retain their ID across arbitrary handoffs and returns.

Only one worker can claim a Task and a logical Bot has WIP one. Busy resources leave
Tasks queued. Claim creates only the receiving role's resource lease, worktree and
temporary Session. The trusted adapter binds the current policy/context and actual
worker. Native/SDK result routing consumes retired worker replies on their original
run surface, so stale results do not fall into Chief chat. Restart blocks interrupted
claims and preserves unknown worker/resource evidence; it does not fabricate exits.

## Decisions and evidence

The actual worker receives Task content, policy, evidence and logical Bot choices.
It returns one `OUTPUT handoff:` JSON decision: handoff, return, complete or
arbitrate. Direct handoff/return names a target and bounded reason; complete and
arbitrate enter Chief's pending pool, never close the Task. No static graph chooses
the next Bot. Ordinary next-role routing needs no Chief approval.

The existing validator enforces role/owner/evidence/idempotency/cycle/quota checks.
Destination-specific `task.poolAcceptance[role]` applies at that handoff; overall
`task.acceptance` applies to Chief admission. Model-supplied evidence is an
untrusted claim, never proof of green CI or signed PASS. Step quota also gates
claim before starting another worker. Runtime execution limits are operator config
`projectExecutionTimeoutMs` (default 120000, bounded to 1000–7200000).

The worker must confirm exit before its claim transfers and capacity becomes free.
Developer completion seals permitted code; Tester completion runs the configured
host verification; Reviewer completion checks exact candidate/test evidence and
may publish the draft candidate PR. A return to Dev after a candidate creates a
new Attempt seeded from that candidate and preserves the previous evidence.
Decision/release Task kinds may hand over outputs without requiring a code commit;
repository/resource admission still applies. Neither execution completion nor
JSON approve grants merge/release or final Task-close permission.

Chief inbox/arbitration and configurable inspection schedules are completed in R6;
conversation-only bridging is integrated in R4. R3's SDK contract-process scenario
covers Dev → Reviewer → Dev → Tester → Reviewer → Chief using a single execution
resource, distinct Sessions, two Attempts and one Task. This is deterministic
protocol evidence, not real Codex or persistent-service acceptance.
