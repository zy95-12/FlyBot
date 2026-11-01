# Develop the backend service alongside autonomous frontend work

Date: 2026-11-01 (Asia/Shanghai).

Class: major — fork service boundary and staged rollout, concluded by the owner.

The owner approved issues #49–#55 and requested sequential implementation while
keeping the existing autonomous frontend workflow running, then staged deployment.
This supersedes the earlier blanket frontend suspension during backend recovery;
backend implementation still belongs to the foreground session, never a FlyBot
development Task. Existing #40/PR48, claims, drafts, role contracts and inspections
remain intact. Use separate issue worktrees/PRs; the first stacks explicitly on
the fetched R6 branch rather than silently reverting its unmerged repairs.

Unify service commands/events/queries and the task read model in S1. Add durable
Effects/outbox, input receipts and Task-based external subscriptions incrementally.
Retain Project authority, safe/watch grants, original Chief memory and autonomous
handoffs. Dedicated service-account deployment is sufficient for the trusted private
instance; per-Bot containers/accounts are not a prerequisite. Leases, confirmed exit,
stale-generation fences and exact-candidate tests/review remain correctness rules.

The staged rollout authorization permits verified service upgrades, not interrupting
healthy workers, changing credentials/control-plane, skipping evidence, merging PRs
or publishing releases. Record tested source and actual deployment separately;
perform upgrades only at a proven safe boundary with rollback and compatibility
checks. A busy service delays deployment while independent implementation proceeds.

Written-by: Codex
