# Shared Project demo

This demo runs the fork's Project workflow with two platform accounts. All new business
logic, browser UI and the gateway live in FlyBot. Control-plane source stays pinned at
`0369a2e0007cd4ca75474c049e7fe57da1f313a6`. Existing account/instance services are reused.

## Prepare

Use Node 22.19+ (CI Node 24), Git, Python 3 with venv and Bash. From the FlyBot checkout:

```sh
npm ci --prefix core --no-fund --no-audit
npm run harness --prefix core
npm ci --prefix dev/demo/browser --no-fund --no-audit
node dev/demo/browser/node_modules/playwright/cli.js install --with-deps chromium
python3 -m venv /tmp/flybot-demo-python
/tmp/flybot-demo-python/bin/python -m pip install -r ../flybot-control-plane/control_plane/requirements.txt -r dev/demo/requirements.txt
```

Use an existing unchanged control-plane checkout beside FlyBot at the pin above. Do not
point this runner at production settings or a running database; the Python adapter always
creates private temporary SQLite with runtime management disabled. It does not edit the
platform checkout. Model execution has ordinary host shell permissions in assigned git
worktrees: this is a trusted-input demo, not isolation for hostile tenant code.

## Automated acceptance

```sh
FLYBOT_DEMO_CONTROL_PLANE=../flybot-control-plane \
FLYBOT_DEMO_PYTHON=/tmp/flybot-demo-python/bin/python \
npm run test:demo:browser
```

Two accounts are registered through real platform invitations. Each has an independent
Chromium context and member session. The runner creates/joins a Project through the UI,
verifies private notes, asks the public Chief to create a Task through scoped tools,
starts actual Developer/Tester/Reviewer worktrees, checks real independent tests and
matching commit evidence, refreshes/retries, checks mobile layout and revokes membership.
It also checks that no owner cookie reaches either browser and raw Harness APIs are denied.
No model/GitHub key is needed: the deterministic transport must reach the missing GitHub
credential gate, and acceptance must remain refused. It cannot be mistaken for successful
real-model PR delivery. The JSON report records source SHA, dirty flag, checks and notRun.
Optional `FLYBOT_DEMO_ARTIFACTS=/private/absolute/directory` saves desktop/mobile screenshots
of the Task board; it records no trace/HAR or storage snapshot. Standard `npm run verify`
includes four actual DSH probes (including real queue/drain/removal), offline guards and
UI/domain tests. CI additionally runs this browser command with pinned Playwright and real terminal lifecycle
checks for both ready-state shutdown and interruption during startup.

## Interactive demo

```sh
/tmp/flybot-demo-python/bin/python dev/demo/control_plane.py \
  --control-plane ../flybot-control-plane --serve-workbench --port 0
```

Enter Alice and Bob passwords privately at startup (12+ characters). Open the printed
**Shared Project workbench** URL in two browser profiles and sign in as
`alice@example.com` and `bob@example.com`. The existing platform panel URL is also printed.
The Harness owner login/cookie stays private. Default model transport is visibly marked
as a deterministic fixture. Terminal Ctrl-C closes the owned runtime/gateway/platform and
removes temporary data. The Python supervisor gives Node time to release its owned DSH
process rather than killing it on KeyboardInterrupt; startup interruption uses the same
cleanup path. Failure retains only that run's private diagnostic directory;
never publish `web.log` or the private profile. This is a local launcher, not deployment.

For actual model and draft GitHub delivery, have the operator supply existing
`DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` to the process through their secret manager (do
not paste values into commands, chat or repo files). Then use explicit options:

```sh
/tmp/flybot-demo-python/bin/python dev/demo/control_plane.py \
  --control-plane ../flybot-control-plane --serve-workbench --real-model --port 0 \
  --github-repo YOUR_ACCOUNT/YOUR_FORK --github-config-dir /absolute/private/gh-config
```

The selected gh account is verified by the broker. Draft artifact PRs are external writes;
use only an explicitly authorized test fork. No automatic merge occurs. This temporary
fixture provisions `code.mjs`/`code.test.mjs` on its own local base; do not select a
repository where those paths carry real application code. The Project repository picker
contains only operator-granted capabilities; other Project owners cannot inherit them by
typing the same name. Model/connector credentials never enter another member's agent.

## Manual acceptance and evidence

1. Alice creates a Project, grants Bob a single-use invitation and sets concurrency to one.
2. Each account adds a different private note. Neither can read the other's notes/history.
3. Bob asks the public Chief to make an addition fix Task with explicit positive/negative
   cases. Confirm Bob is requester and both accounts see the same Task.
4. Bob starts delivery. Inspect separate role workspaces, Developer diff, independently
   executed tests and Review at the exact candidate SHA; open the actual draft PR.
5. Alice requests changes. Retry must create a distinct Attempt and preserve the returned
   evidence. Accept only after tests/Review/PR head match the new candidate. Task becomes
   accepted; the rolling seven-day metric gains one unique Task.
6. Start two Tasks at quota one: second waits without worktree allocation and starts after
   release. Fail another Task, inspect its log and retry. Refresh must preserve history and
   duplicate requests must not allocate a second active Attempt.
7. Remove Bob while another request waits. The waiting request cancels, stale page clears
   and further Project operations fail. Inspect remaining Worker leases before cleanup.
8. Stop with Ctrl-C and confirm owned processes/data/worktrees are cleaned. Never touch a
   pre-existing runtime or the user's `~/.dsh`.

| Evidence | What it proves | Status boundary |
| --- | --- | --- |
| Unit/DOM/gateway regressions | ownership, authorization, stale evidence, return/retry/accept, late response/privacy and route restrictions | Test fixtures; not live-model evidence |
| Four actual DSH probes | real shell/cwd/code/tests, scoped agent tools, credential refusal, queue/drain/revocation and cleanup | Deterministic model |
| Two real platform accounts + Chromium | actual shared entry, UI flows, actual role execution, refresh/retry/mobile/revoke | Deterministic model; no GitHub publication in this run |
| Existing M3 draft artifact PR #12 | real Git/GitHub publication, SHA matching and runtime human acceptance | Deterministic model; no independent repository review PASS |
| Full manual flow with configured provider | real model → tests/Review → draft PR → human return/retry/accept | Pending available model configuration and observed acceptance |

Do not close M3/M6 acceptance issues or call the real-model demo accepted until that last
row has a source SHA, Project/Task/Attempt ids, candidate/PR SHA, logs and observed human
outcome. CPU/RSS shown in the app measure the shared process; absent per-Project/GPU metrics
stay unavailable. No production deployment, untrusted-code sandbox, multi-host pool,
auto-merge or exact crash continuation is claimed.
