# Real-provider shared Project acceptance — 2026-10-31

Result: passed on implementation commit
`f126f8cb62c0298b37c46b68f3f8221c8e8f9441` with a clean worktree. The complete
run took 408,914 ms. [Machine-readable evidence](../dev/demo/evidence/live-2026-10-31.json)
records actual Task/Attempt ids, test-log hashes, review SHA, PR SHA and timing.

The operator explicitly supplied an official DeepSeek credential for this validation.
Model catalog and real inference probes succeeded. The run used `deepseek-flash` through
DeepSeek's [official Anthropic-compatible endpoint](https://api-docs.deepseek.com/guides/anthropic_api/),
actual DSH, two real temporary control-plane accounts, separate Chromium contexts, the
restricted gateway and the operator-selected GitHub identity `zy95-12`. The mock endpoint
received zero model requests. Credentials were supplied through process input/environment,
never source files, documentation, artifact reports or model task prompts.

## Delivery evidence

| Step | Evidence |
| --- | --- |
| Bob requirement → real public Chief tool → one Task | `task-020c780e7594851a` in `project-33205cea-54a3-4fef-b72e-b5e1775986b1`; requester Bob; duplicate tool calls reuse the Task |
| First independently tested/reviewed candidate | `3210f18b4a1d9c14cef007b042511ec14f5cc2df`, [draft artifact PR #18](https://github.com/zy95-12/FlyBot/pull/18) |
| Alice browser return | Requested a dedicated `add(-4.5, 0) === -4.5` regression; old evidence retained and feedback snapshotted into the next Attempt |
| Real model follow-up | `a81191adf546541653b9a457432c358a0cc9ec97`, [draft artifact PR #19](https://github.com/zy95-12/FlyBot/pull/19); tests/Review/PR head all match this SHA |
| Actual changed regression test | GitHub blobs differ: `cb5ac812cac8d4058af2c5106f2815ed41434e03` → `6480474c9ff620f31c537f828a96ed12e7620352`; the new file adds negative-fractional/zero assertions absent from the first |
| Alice browser accepts / Bob cannot accept | Canonical Task accepted; rolling-seven-day accepted Task count 1, one timing sample 158,019 ms |
| Intentional failure and retry | Two real-model Attempts hit the immutable host's forced nonzero exit, retain false test evidence, create no PR and cannot be accepted |
| Quota/revocation | At quota one, another request waits without allocating an Attempt/worktree; removing Bob cancels it and rejects old Project/agent access |
| Isolation/cleanup | Each private agent receives its own structured notes; no owner cookie in either browser; raw Harness APIs refused; all Worker leases/worktrees released; temporary platform/runtime data removed |

The first evidence row in the JSON records its *observed status before return*; the
second row's `human-return` feedback and accepted result record the subsequent transition.
The intentionally interrupted earlier run created [draft artifact #17](https://github.com/zy95-12/FlyBot/pull/17)
before cancellation. It is not the accepted end-to-end run. All these artifact PRs remain
draft and unmerged; they are distinct from milestone implementation PR #16.

## Bugs exposed by real model/browser execution

1. Long Project names lost the member discriminator under the host's 40-character Bot
   name limit. Logical identity digests now precede short labels; a truncation-contract
   regression reproduces the old duplicate-name failure.
2. Structured scoped-tool returns under a string schema rendered as `[object Object]`.
   Real models could not read Task ids/context and retried creation. JSON rendering and
   per-human-delegation serialized Task/proposal idempotence fix both causes. Two defect
   tests fail on the old behavior and pass with the change.
3. Human return reasons were absent from retry input. The new Attempt now snapshots the
   prior reason/id/SHA as task data. The return/retry regression fails without propagation.

## Validation and limits

Full `TZ=UTC ARCH_DOCS_BASE=origin/main npm run verify` passed as the normal node user at
the implementation SHA above, including four key-free actual DSH probes. Focused Project
agent/delivery cases, the real live check, package checks, strict declaration types and
actionlint also passed. Later evidence/documentation commits do not change executable code.

Control-plane API/dashboard remain byte-identical to immutable
`0369a2e0007cd4ca75474c049e7fe57da1f313a6`: 27 files, digest
`e64502f0f278f658140e5f22a1e957df34a3e2d42cd44023e07975ea0de3a380`.
A credential scan of 1,478 repository/evidence/log files found zero occurrences of the
provided key. Failed-run diagnostic trees were also removed after their owned processes
stopped. No production service or live DSH profile was used.

Alice/Bob are browser-automated human *roles*: this proves the authorization and acceptance
UI path, not an independent human code review or repository Reviewer PASS. No merge,
production deployment, hostile-code sandbox or multi-host readiness is claimed. M3/M6's
previous real-provider acceptance blocker is resolved for this fixed shared-project demo;
implementation review, CI and merging remain separate gates.
