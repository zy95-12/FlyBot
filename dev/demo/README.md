# M0 development baseline

This checks the fork against the published DSH **0.2.1-rc.2** packages. It needs
Node 22.19+ (CI uses Node 24), npm and bash. No harness source checkout, model key,
GitHub credential, Docker daemon or existing DSH profile is needed.

From the FlyBot checkout:

```sh
npm ci --prefix core --no-fund --no-audit
npm run harness --prefix core
npm run demo:check
```

The command launches a real DSH web process and the existing FlyBot core and
Workflow plugin on loopback, with random available ports and disposable private
data under the system temporary directory. Its model transport is deterministic:
**this is not real-model or GitHub PR acceptance**. The actual DSH agent executes
bash, writes a JavaScript module, runs an assertion, and returns a tool result.
The runner independently imports the written module and checks another case.

It checks ephemeral creation, owner attribution and removal, default team cwd,
an ordinary Bot's explicit cwd, the model's session header, authenticated HTTP,
two distinct member sessions, and the existing refusal of shared plugin writes.
It does not weaken authorization to make a shared-workflow demo pass.

On success the processes and temporary data are removed. On failure the same
process cleanup runs and a private diagnostics directory is retained. Subprocess
scratch and native-loader caches are confined to the fixture's own temporary tree.
`web.log`
contains the disposable DSH login credential: do not publish it. The JSON report
contains no credentials; optionally set `M0_REPORT=/absolute/path/report.json` to
save that report. It records the source SHA, dirty status, DSH version and checks.
Run the command in the foreground and let it finish; retained failure data can be
removed once diagnosed. This is a development fixture, not a sandbox against
untrusted code or a production launcher.

## Automatic regression coverage

`npm run test:demo` runs the offline artifact and platform-entry guard cases.
`npm run test:demo:runtime` starts real DSH and verifies actual code/tool effects and
cleanup. Both and `lint:demo` run in `npm run verify` and the required CI test job.
Python 3 is required for the entry guard cases. CI separately installs the existing
platform's dependencies, runs the HTTP check against a pinned unchanged checkout,
and refuses platform working-tree changes. It needs no model key or user-supplied
GitHub token; checkout uses the job's existing read-only repository access.

The artifact suite rejects constant-output code, missing files/exports, wrong cwd,
false test success and fabricated results. A claimed completion message alone
cannot satisfy the checker. Ownership: [demo-baseline](../../docs/subsystems/demo-baseline.md).

## Reuse the control plane

Clone the unchanged `main` of `zy95-12/flybot-control-plane` beside this checkout.
The validation code lives here in FlyBot; no control-plane patch is required:

```sh
uv venv /tmp/flybot-m0-python
uv pip install --python /tmp/flybot-m0-python/bin/python \
  -r ../flybot-control-plane/control_plane/requirements.txt -r dev/demo/requirements.txt
/tmp/flybot-m0-python/bin/python dev/demo/control_plane.py \
  --control-plane ../flybot-control-plane --check --port 0
```

Without `--check`, the script asks for a temporary admin password and serves the
existing panel on loopback (default port 18088). Data is private, disposable and
deleted on exit. The script does not load production environment files, overrides
database/cookie/domain settings in its own process and disables runtime management.
It suppresses bytecode writes in the external checkout. No manager, upgrade script,
platform deployment configuration or control-plane source file is changed.

`--check` exercises real HTTP login, invitation, registration, two independent
users, CSRF and admin gates. Both checks remain independent until platform
identities are linked to FlyBot members; this is not a working shared project.
Prefer FlyBot-side adapters for future integration. A truly missing platform API
must be documented separately before proposing a minimal control-plane change.

## Image provenance

The existing Docker path is retained. Build an isolated tag from the checkout:

```sh
docker build --build-arg FLYBOT_SOURCE_REPOSITORY=zy95-12/FlyBot \
  --build-arg FLYBOT_REVISION="$(git rev-parse HEAD)" -t flybot:m0-baseline .
docker image inspect flybot:m0-baseline --format '{{json .Config.Labels}}'
```

Compose forwards `FLYBOT_SOURCE_REPOSITORY` and `FLYBOT_REVISION` as build args.
Supply the revision explicitly; an omitted revision is honestly `unknown`.
Labels identify the operator-declared source and commit, not proof that a dirty
working tree matches that commit. Use a clean checkout for release provenance.
Do not use the existing production Compose project for a demo.

## Next-stage interface findings

| Capability | M0 result | Follow-up |
| --- | --- | --- |
| Real DSH HTTP and bash execution | Exercised with deterministic model | Real-model/PR acceptance in M3/M6 |
| Temporary Workflow Bot lifecycle | Creation, owner and cleanup exercised | Per-run execution records in M3 |
| Working directory | Explicit ordinary Bot cwd works; Workflow Bots default to the FlyBot team workspace | Add run/worktree cwd to the sanctioned spawn path in M3 |
| Two FlyBot member sessions | Distinct identities and session tokens work | Link authenticated platform users in M2 |
| Shared Workflow write | Correctly refused as `bot/blocked-shared` | Project-scoped authorization in M2 |
| Project ownership | Existing instance-local Project bindings | Stable Project/Task/Run contracts in M1 |
| Control-plane host manager | Existing API/panel reused unchanged; manager not started | Original manager remains site-bound and depends on historical overlay templates; integration must not assume it is portable |

The current sidebar and Project UI impose no constraints on future APIs. M5
rebuilds the task navigation and Project board around the new domain contracts.

## M5/M6 shared Project entry

The rebuilt UI, restricted gateway, quota queue and two-account browser/interactive demo
are documented in [shared demo](../../docs/shared-demo.md). `npm run test:demo:browser`
needs the pinned optional Playwright package and explicit control-plane/Python paths. The
foreground `--serve-workbench` launcher privately prompts for demo account passwords and
shares only the restricted gateway URL. True-model mode requires explicit existing model
configuration and is never silently replaced by the deterministic model.


The optional operator helper `platform-principal.py --db /absolute/platform.sqlite`
reads one account status for persistent watch grants; it must run under the DB
owner using a fixed root-owned command. It does not log in, modify control-plane
source or return credentials. See [delegation setup](../../docs/subsystems/project-delegations.md).
