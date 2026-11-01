---
subsystem: service-acceptance
owned_paths:
  - dev/demo/service-recovery.mjs
  - dev/demo/test/service-recovery.test.mjs
---

# Development service recovery acceptance (S6)

`npm run demo:service-recovery -- --output <new-private-report.json>` repeats the
isolated fault/contract matrix using the existing real-store/Git/workspace tests.
It is not a production fault injector or another orchestrator. No runtime home,
repository, account, token or remote API can be selected. The fixed scenarios use
disposable test data and controlled SDK/GitHub adapters; real vendor acceptance is
recorded separately. See [operator runbook](../service-recovery-demo.md).

The runner invokes exact named tests with argv, serially and with bounded heap,
timeout and output. Ambient credential/config/test-runner variables are excluded.
A zero exit without an executed passing scenario, missing summary, failure or
signal cannot be reported as success. Changing a test name therefore fails the
runner rather than silently passing an empty selection. Protocol versions and the
actual Git revision bind the report to source. Public output contains counts and
hashes; raw fixture logs are private0600 under a0700 directory. Existing evidence
is never overwritten. Report paths do not select fault-injection targets.

The matrix includes saved-not-dispatched, uncommitted/failed-save, delivered/lost
receipt, remote-success/local-receipt failure, generation replay, duplicate/edit/
out-of-order sources, old SHA, stopped/context Task, revoked write, full resource/
double reservation, unknown exit, role return/rework, busy same-thread input,
browser-offline native source polling and private-agent scope. Actual store/rename,
temporary files/worktrees and some controlled child processes run; this does not
claim a real Codex/Claude/GitHub operation. Core suites still run every regression
without filtering during full verification. The CLI's selected scenarios are not
repository-wide test/coverage results.

Production evidence uses the original frontend Task/PR and native Bot contracts:
actual Source event→durable input→current role receipts, autonomous rework/handoff,
same-candidate test/Review/PR, real SDK version/resource/exit and Chief adjudication.
No manual input relay, duplicate acceptance Task, production reset or fake vendor
proof is allowed. Code/component/config origins, timestamps and cleanup are recorded
privately without credentials. The original UI/dual-mode/inspection residuals in
#41 remain separate; this service matrix does not silently close them.
