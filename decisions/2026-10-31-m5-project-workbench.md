# M5 — shared Project workbench and admission queue

Date: 2026-10-31. Decision-maker: fork owner (`zy95-12`), through the session request
to continue M1–M6, one PR each, reuse control-plane and rebuild the task/Project UI.
Implementation: Codex. No additional human review verdict is claimed.

Implement a standalone Project-first browser app behind a restricted FlyBot-owned gateway.
Keeping the private Harness owner cookie out of member browsers is required to make
Project-scoped APIs effective. Reuse unchanged platform login/account/instance services.
The UI presents actual Task/Attempt/evidence/agent/member/resource state.

Add durable quota admission around the existing Workflow executor, with current authority
checks before queued execution and no premature worktree allocation. Preserve history and
orphan Worker capacity. Repository capabilities follow operator-provisioned Project owners.

Validation is recorded on the implementation PR at its tested tip. Full browser acceptance
and true-model delivery remain M6 work; missing model credentials cannot be replaced with
fixture evidence. No production deployment, merge or control-plane change is authorized by
this decision. Host code execution remains a trusted-input demo, not hostile tenant isolation.
