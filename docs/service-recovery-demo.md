# Service recovery demonstration

Scope: fork #49/#55. Reuse the original shared service/accounts/evidence from #41;
do not create another copy of its acceptance Task. Backend work is implemented in
the foreground session, while original frontend Task40/PR48 continues through
native Bot contracts. Control-plane accounts/instance management are unchanged.

## Prerequisites and source

Use a Git checkout with Node22.15+ (verified on22.22.3/24.22.1), core dependencies
and the pinned development Harness installed. Native frontend builds also require
the existing locked core dev dependencies. The CLI requires a source revision;
an unpacked runtime directory without Git is not a source-bound acceptance report.

Keep Source/Effect/input/role contract versions and source/component hashes with
each result. Distinguish canonical code from any retained runtime overlay, and
record actual UI asset origin independently from a compatible backend component.
An integration branch is not a merge of a GitHub PR or a release.

## Isolated fault matrix

```sh
npm run demo:service-recovery -- --list
npm run demo:service-recovery -- --output /tmp/flybot-service-recovery-new.json
npm run demo:service-recovery -- --scenario remote-success-local-failure
```

Choose a new private output path per run. The runner serializes exact selected
regressions, creates no production target and never reads shared-service credentials.
It tests real local store/files/Git plus controlled adapters. Its JSON names every
scenario, selected passing/failing counts, source revision, contracts and Not run
items; raw logs remain private. A missing/renamed test or zero executed tests fails.

The fixture faults cover save-before-dispatch, checkpoint/receipt write failures,
remote response loss and restart reconciliation. They must preserve original
IDs/receipts and refuse double writes, old callbacks and unknown exits. Duplicate/
out-of-order/edit sources, old-SHA CI, busy same-thread input, full resources,
revoked writes and browser-offline polling have explicit positive/negative results.
Do not kill a healthy production SDK process to manufacture these failures.

## Real original-Task acceptance

1. Record the existing Project/Task/Attempt/PR, current candidate, requirements,
   role policy hashes, actual SDK/resource and current Source subscription. Preserve
   previous Attempts and failure history. Ordinary questions still go to Chief.
2. Use the supported service command/API, native tool and logical schedule adapters;
   compare their authoritative TaskView/rights/claims/evidence. Never post role
   output or a fake execution receipt through a human endpoint.
3. Subscribe the existing PR/Issue to the original Task with an explicit Source
   mode/history policy. Configure polling through the original logical scheduled
   task service. Keep Chief inspection's existing configured interval unchanged.
4. Post a real, in-scope frontend review finding on that PR. Let native polling
   ingest it after the creating browser session closes. Do not manually publish a
   second Task input or force a role route to make the test pass.
5. Record external event/revision, commit Effect, input ID/hash, injected batch,
   actual current-role read/handled declarations, real SDK output/exit and actual
   handoff. A transport receipt is not reading, and reading is not Task completion.
   A sealed candidate needing correction gets a successor Attempt through Chief's
   existing rules; Task and PR remain the same.
6. Verify new host tests, independent role Review and remote PR head bind to the
   same candidate. Remote CI/Review is context, never substitute host evidence.
   Observe Chief's completion/defer decision without per-step approval. Retain any
   original UI acceptance hold honestly instead of forcing closure.
7. Restore temporary acceptance polling configuration, close only test-created
   sessions and remove isolated data. Do not revoke the user's unrelated sessions,
   change credentials/resources/sandbox or stop healthy frontend work.

Real Codex/GitHub runs and controlled fixture runs have separate reports. Claude,
other resource profiles and hostile-code isolation remain Not run unless actually
exercised. No green CI/single smoke/PR existence establishes this whole path.

## Checkpoint rollout and UI evidence

Backend stages use explicit source bases and full verification, then actual service
UID checks. Inspect current SDK/leases/Chief jobs, queued/running logical deliveries
and host-verifier/workspace activity before switching; defer to healthy work.
Keep source/state backups, current candidate/index hash and original Task/PR.
Never edit state, delete merge metadata or grant SDK shared refs to recover.

Import a verified frontend candidate from the native pipeline and preserve its
parentage. Combine its native assets **and** required personal-Chief/conversation/
resource handlers with the current backend. Rebuild/check source and generated
artifacts; resolve real source/docs first and regenerate patches. A static JS swap
without its required handlers is not a valid UI rollout.

After a verified idle-boundary rollout, use the existing Owner/Maintainer/Member
login flow and original UI components. Check Project/task/room/native/personal/public
views, scope negatives, refresh/narrow viewport and relevant weak-network behavior.
Capture screenshots without passwords/tokens and record exact UI/backend hashes.
Do not claim the polished reference or #41's full matrix passed from API/DOM tests.

Rollback must respect newly persisted inputs and authority semantics. Retain the
S4 GitHub-source authorization adapter after source-input admission; do not silently
restore old state or an older adapter that treats external principals differently.
Prefer a forward fix when state/contracts have advanced. No merge/release, public
hosting, control-plane or credential migration is implied by this runbook.


S6 dependency preparation uses the complete deployed release graph, including native
React/UI packages, rather than mixing the old private native cache. The versioned
`dev/demo/prepare-worktree.mjs` adapter refuses unknown existing entries. For legacy
managed workspaces, first prove SDK/leases released and preserve Git HEAD/index/status;
back up their untracked dependency directory outside the worktree, then prepare as
the service UID. Preserve the original Task/PR and source-admit the current Attempt
through the Owner API. This operator migration does not edit task state or Git code.


S6 live recovery also fences SDK-owned Chief delegations before asynchronous worker
registration. Dormant native DSH turn/end events must not consume the scheduled SDK
job during that setup window; only its fenced SDK callback may finish it. The
regression injects that event before a worker ID exists, then requires exactly one
completion from the actual bound callback. Native-only execution retains its events.


A late result-handler failure cannot overwrite a confirmed released SDK lifecycle.
Historical failed-status rows with a successful process exit may still prove exit
only when worker ID/generation, Project/Attempt/role/resource and both worker/lease
stop proofs match a released SDK lease exactly. Unknown/unreachable exits, missing
proofs and mismatched leases remain refused. This preserves historical failure
attribution without blocking every future integration admission for the same Task.
