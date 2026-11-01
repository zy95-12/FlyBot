# Repair the backend directly before resuming frontend dogfood

Date: 2026-11-01 (Asia/Shanghai).

Class: major — fork development execution and ordering, concluded by the owner.

The owner instructed: “你不要通过flybot下发任务的方式去修改后端问题了，请你直接在当前session中修改后端问题，前端问题可以在后端问题搞定后，再由flybot下发执行”.

Backend repairs run in the foreground Codex session, under existing #34–#41/PR
ownership. Preserve the frontend Task, drafts, Attempts and PR48, suspend its
automatic execution while stabilizing the backend, then resume through the normal
scoped FlyBot API after verification. Preserve failure/evidence records; no
synthetic Bot completion or Reviewer PASS.

Initial repairs cover proven unbound reservation leaks before role startup,
repeated wake overlap, blocked queue recovery and receiving-workspace preparation.
Commands remain operator configuration, never Task-supplied shell instructions.
Current Project authority, immutable candidate tests/review and confirmed release
remain required. This does not authorize control-plane source changes, public
hosting, merges, auto-merge or releases. Deployment and live acceptance are reported
separately from source verification. No independent review is claimed here.

Written-by: Codex
