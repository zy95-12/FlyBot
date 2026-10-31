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
