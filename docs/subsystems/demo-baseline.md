---
subsystem: demo-baseline
owned_paths:
  - dev/demo/
  - scripts/lint-demo.mjs
---

# demo-baseline

Fork M0 tooling, not a shipped runtime/platform service. Scope: [fork decision](../../decisions/2026-10-31-project-first-fork.md).

## Boundaries

- `run.mjs` uses pinned published DSH, core/Workflow, private temporary data and a
  deterministic loopback model. Actual bash writes/tests code; `artifact.mjs`
  independently verifies cwd, evidence and cases with distinct expected results.
  Child TMPDIR/TMP/TEMP live inside that private tree so spill/native-loader data
  is included in cleanup; the runtime test checks the enclosing temp directory.
- `control_plane.py` imports an explicitly selected external platform checkout with
  bytecode writes disabled and disposable SQLite settings. It reuses panel/auth APIs;
  it never starts the privileged manager or changes source, upgrade or deploy settings.
  CI pins the external revision and checks that its working tree remains unchanged.
- Existing multi-member write denials are asserted, not removed. Real-model PR delivery,
  identity mapping and per-run cwd are later work. No current UI structure is required.

## Tests

`npm run test:demo` covers missing/false artifacts, wrong cwd, failed tests, fabricated
results, constant output, missing exports, invalid platform paths and optimized-Python
refusal. `npm run test:demo:runtime` checks actual DSH/tool execution, ephemeral
owner/cleanup, cwd/member boundaries and temporary-data cleanup. Both and `lint:demo`
run in local verify and the required CI test job. That job separately exercises
real HTTP against unchanged pinned platform source. Layers are in `docs/testing-layers.json`.

Changes update this doc and regression cases, plus Project State/decisions when scope
changes. [Install](install.md) owns OCI/Compose; core-host/workflow own runtime features.

## Fork M1 — 2026-10-31

M1 extends the actual DSH runtime probe: create a Project Task, rebind its Bot, check
the original Project board, execute the Workflow and assert both plugin/host direct
projectId plus the terminal Run report. This runs via test:demo:runtime and verify.

## Fork M2 — 2026-10-31

M2 adds --shared-check to the external platform adapter and shared.mjs to the existing
actual DSH harness. Credentials travel over stdin. It checks two platform logins, invite/
shared Task/Workflow, member removal, platform suspension and logout; the required test
job executes it against unchanged pinned platform source. [Contract](project-access.md).

## Fork M3 — 2026-10-31

M3 adds the --delivery actual DSH probe and delivery.mjs fixture. The required runtime
test verifies role cwd, code edit, independent tests, commit-specific reviewer output,
missing-credential refusal and cleanup. --github-repo/--github-config-dir explicitly
enable remote draft publication outside routine CI; artifact #12 is deterministic-model
integration evidence, not independent Review or true-model acceptance. [Contract](project-delivery.md).

## Fork M4 — 2026-10-31

M4 adds --agents to actual DSH runtime verification: two private agent Sessions use
scoped tools; private proposal publication and public Chief Task creation retain the
requester; private memory and revoked old Session routes are checked. The required
runtime suite runs this fixture alongside M0/M3; no true-model/personal-GitHub claim.

M5 adds `node dev/demo/run.mjs --queue`: real DSH + deterministic model, three shared
Tasks with quota one, no allocation while waiting, automatic drain after Worker release,
duplicate request identity and cancellation after member removal. It is part of runtime
verify. This is not a real model or GitHub publication test.

M6 adds the optional browser development package (pinned Playwright), `browser-check.mjs`,
`workbench.mjs` and a foreground `serve.mjs` gateway launcher. CI installs Chromium and
runs `npm run test:demo:browser` against the same immutable control-plane checkout. Standard
verify retains the four key-free actual DSH probes and offline entry guards. Browser
acceptance requires explicit platform/Python/browser installations; it is not silently
skipped or replaced by DOM fixtures. Passwords enter the DSH runner via stdin; no browser
trace/HAR, cookies or model credentials are emitted. Failure diagnostics stay private.

Terminal lifecycle is covered by `serve_check.py`: it privately enters random passwords,
logs in through the real gateway, sends Ctrl-C after readiness and separately during
startup, and asserts the owned temporary tree is empty. The supervisor waits for Node's
graceful cleanup; it does not use subprocess.run's immediate kill-on-KeyboardInterrupt.

`--live-check` explicitly selects real DeepSeek and GitHub browser acceptance. It refuses
missing provider environment or fork/credential configuration, uses an immutable host
addition test outside model worktrees, runs actual scoped private/public agent tools,
returns a candidate through Alice's UI, checks new tests/commit and PR SHA on retry, then
accepts through Alice's UI. A second operator fixture forces host-test failure and checks
retry/queue/revocation. No mock-model request is permitted in this mode. The CLI supervisor
allows a bounded 20-minute live run; key-free regression timeouts are unchanged.

The real-provider run subsequently passed at `f126f8c`; [live acceptance](../live-acceptance.md)
and the committed JSON record preserve source/evidence/timing and distinguish human-role
browser automation from an independent human or repository review PASS.

### M7.1 context probe

The existing actual-DSH delivery probe explicitly publishes one memory per worker role
and configures its reference. For the marked local fixture, the deterministic model checks
its received system request contains published memory, repository instructions and context
version before issuing shell work. The host also verifies three distinct bound Sessions
reach released state. This validates real Harness transport/lifecycle, not real inference.
