# M4: separate public Project agents, private human agents and credential scopes

Date: 2026-10-31. Class: major fork authority/privacy. Status: owner-authorized
implementation; review/merge separate; real-model/browser acceptance tracked in M6.
Written-by: Codex.

Use a fresh public Chief Session so legacy owner-private context is not made public.
Store each private identity/notes/transcript/proposal under one human and Project.
Preserve logical identity when a Bot/Session carrier changes. Private content is never
automatically copied into shared knowledge; a private Task proposal needs explicit
human publication. Public Chief acts only for the captured current public requester.

Bind every agent tool to the current own Session and live delegation, verify current
membership/session after async authentication, and deny generic filesystem/team/connector
tools. Group or old Sessions cannot borrow that authority. Model persona and skill labels
cannot confer human privilege. Role revisions and resolved skill content are snapshotted
on code Attempts. Delete retires scoped agents and clears private material while preserving
shared history and project evidence.

Keep Project automation and exact human/Project personal GitHub sources separate. Verify
actual login, strip ambient token overrides, never fall back to another identity, and retain
initiator/executor/scope audit. Credentials stay outside model/test contexts.

Evidence: [issue #6](https://github.com/zy95-12/FlyBot/issues/6), scoped agent/credential
regressions and actual DSH deterministic-model probes. Existing code-worker OS isolation
and outer DSH browser API fencing are distinct boundaries, recorded in the [contract](../docs/subsystems/project-agents.md).
No real-model acceptance or independent code-review PASS is claimed.
