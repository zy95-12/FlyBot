# M2: validate platform sessions and authorize within Project

Date: 2026-10-31. Class: major fork architecture/security. Status: owner-authorized
implementation, review/merge separate. Written-by: Codex.

The owner authorized M1–M6, one PR per milestone, with memory/architecture/tests, and
requires control-plane reuse. M2 is split into independently testable identity adapter,
Project membership policy and scoped Workflow gateway within one milestone PR.

Use existing platform login/session/logout unchanged through a FlyBot BFF. Explicit
operator ownerSubject provisioning prevents first-login ownership claims. Validate
upstream sessions on every request; credentials are memory-only, so restart signs out.
Do not trust body claims or turn platform admin/AI labels into Project authorization.

Project roles/invites/quotas stay in FlyBot. Enable sharing only on an explicitly
configured Project workbench path. Refuse unscoped plugin reads/writes, auto-routing
and ambient external connector credentials on that path. Reuse the current Workflow
service through one scoped gateway; derive execution owner and connector ceilings
from the Project. Preserve admitted work and attribution after member removal, while
revoking reads and new requests immediately. M3/M4 add physical isolation and explicit
agent/credential delegation. [Contract](../docs/subsystems/project-access.md).

Evidence: [M2 issue #4](https://github.com/zy95-12/FlyBot/issues/4), tests reproduced the
five initial access gaps, actual unchanged-platform + DSH two-account probe passes.
Final commit verification is recorded in the milestone PR. No independent reviewer
PASS, production deployment or true-model GitHub delivery is claimed here.
