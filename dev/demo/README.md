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
process cleanup runs and a private diagnostics directory is retained. `web.log`
contains the disposable DSH login credential: do not publish it. The JSON report
contains no credentials; optionally set `M0_REPORT=/absolute/path/report.json` to
save that report. It records the source SHA, dirty status, DSH version and checks.
Run the command in the foreground and let it finish; retained failure data can be
removed once diagnosed. This is a development fixture, not a sandbox against
untrusted code or a production launcher.

## Reuse the control plane

Clone `zy95-12/flybot-control-plane` beside this checkout and follow that repo's
`dev/README.md`. Its `local_demo.py` starts the existing panel and FastAPI API with
a fresh private SQLite database. `--check` exercises real HTTP login, invitation,
registration, two independent users, CSRF and admin gates. No privileged host
manager runs. Both checks are independent until M2 links platform identities to
FlyBot members; two successful checks are not a working shared project.

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
| Control-plane host manager | Existing API/panel reusable; manager not started | Existing privileged deployment remains site-bound; see control-plane dev notes |

The current sidebar and Project UI impose no constraints on future APIs. M5
rebuilds the task navigation and Project board around the new domain contracts.
