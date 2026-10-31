# M1: freeze work ownership independently of execution carriers

Date: 2026-10-31. Class: major fork architecture. Status: owner-authorized implementation;
review and merge remain separate. Written-by: Codex.

The fork owner requested M1 implementation with repository memory and tests, then
explicitly authorized continuing M2–M6 with one PR per milestone. The control-plane
reuse constraint remains in force. No independent reviewer approval is claimed.

A Task or Run must not move Project when a Bot/room/workflow is rebound. Extract
Project application service, policy and repository boundaries from store/board, keep
single-process storage, and freeze direct ownership at creation or explicit migration.
Ambiguous historical bindings remain unresolved with evidence. Archive gates new work;
delete preserves history and refuses unfinished work. Member removal cannot orphan
live ownership. See [contract](../docs/subsystems/project-domain.md).

Workspace in M1 is a registered path reference, not an allocated isolated worktree.
Public/private agent definitions, platform subject mapping, full human authorization,
crash reconciliation and frontend rebuilding stay in M2–M6. Existing upstream stage
restrictions do not replace the owner's accepted fork roadmap.

Evidence: [issue #3](https://github.com/zy95-12/FlyBot/issues/3); regression first reproduced
as 5 failing ownership/lifecycle tests, followed by core/workflow tests and actual DSH
verification. Exact final validation results belong in the milestone PR.
