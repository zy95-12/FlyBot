# M3: bind delivery acceptance to a sealed commit

Date: 2026-10-31. Class: major fork execution architecture. Status: implementation
owner-authorized; true-model acceptance pending; review/merge separate. Written-by: Codex.

The owner authorized M1–M6 with one implementation PR per milestone and repository
memory/tests. M3 reuses the current Workflow service with real evidence gates, versioned
fixed Developer/Tester/Reviewer graph, independent worktrees and explicit human acceptance.
It does not add another workflow engine or enable automatic merging.

Persist idempotency/cleanup intent before side effects. Fix Project/Task/Attempt/cwd,
model/role graph, branch and evidence SHA. Independently run configured tests and require
structured Review for that same clean commit. Recheck current PR head at human acceptance.
A node's completion text or supplied Task evidence cannot substitute for those gates.
Restart marks interrupted work explicitly; retry keeps old attempts and evidence.

Actual DSH exposed the existing guard against workdirs inside DSH data. Worktree roots
therefore sit outside that data and host registration constrains their creation/cleanup.
GitHub credentials are explicitly operator-selected and remain outside Bot/test context.
The runtime publishes draft artifacts only. The small fixture uses worktree separation,
not an OS sandbox; stronger production isolation is a separate requirement.

Evidence: [issue #5](https://github.com/zy95-12/FlyBot/issues/5), actual Git/Node regression
suite and actual DSH probes, plus real draft [artifact PR #12](https://github.com/zy95-12/FlyBot/pull/12)
with test/Review/head `d8371cbc797889340b602bf1352011a7c3fd7d7d`. Model transport for that artifact
was deterministic. A real model configuration was requested asynchronously; no secret
was requested in chat. This record claims neither real-model acceptance nor independent
code-review PASS. [Contract](../docs/subsystems/project-delivery.md).
