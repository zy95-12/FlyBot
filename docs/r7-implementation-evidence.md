# Issue #40 rework evidence — 2026-11-01

Current rework base/HEAD: `f03f89d5b933fe315ad3fc937b3702533125bcb3`.
Changes below are unsealed; the host must seal a new candidate before Tester checks.
All earlier sections are historical evidence, not results for this draft.

## Failure record and red/green

Read the complete available raw host log `verify-ba82b9e3-77b4-465d-a702-7f48fc3d6be2.log`
(812859 bytes, SHA256 `95d69c6c282e0de02bff7948cf2b5a07c935edde758530c64ec664d0fdcebc46`).
It reports 2477/2478 core tests passing; the only failure is install.test.js's exact
registration order missing the Project `llm/stream` observer. This raw log hash is
not the handoff's test-evidence receipt hash `7a6485a58e61942cf259b3bd2c8375ff01e4e8b54fe6e888a3647b1b1f061054`;
no claim is made that these are the same artifact. The other available raw logs
include a system-npm semver setup failure and a separate successful historical run;
neither supplies passing evidence for this draft.

Before edits, `node --import ./core/test/harness-resolve.mjs --test core/test/install.test.js`
reproduced 3 pass / 1 fail at the pinned base. The expectation now includes the
existing observer; no production listener or authorization guard was removed.

Added channel checks to the browser runner BEFORE changing its authenticate stub.
`node --import ./core/test/harness-resolve.mjs dev/demo/collaboration-browser.mjs --channel-only`
then failed on the first valid-role request (false !== true). After correcting the
stub to accept the extracted token string, this command passes all three role,
unknown-token and revoked-token assertions. It now runs in test:demo/verify without
Playwright or sockets. The full browser path remains enabled by default.

## Checks personally run on this unsealed draft

Commands use `/usr/local/lib/flybot-shared/node`:

- Operator `verify-worktree.mjs --prepare-only`: passed.
- `--import ./core/test/harness-resolve.mjs --test core/test/install.test.js core/test/project-agents.test.js core/test/workbench-client.test.js`: 39/39 passed.
- `--import ./core/test/harness-resolve.mjs dev/demo/collaboration-browser.mjs --channel-only`: passed.
- `--test dev/demo/test/artifact.test.mjs dev/demo/test/control-plane-guards.test.mjs`: 10/10 passed.
- `scripts/lint-demo.mjs`: passed.
- `scripts/ds-bot-patches.mjs generate`, `check`, `canonical`: all passed; patch mirror regenerated.
- `core/scripts/build-client.mjs --check`, `core/scripts/build-workbench.mjs --check`: passed; no client source change.
- `git diff --check`: passed.

Full `TZ=UTC npm run verify` via the provisioned npm CLI was attempted; sandbox
rejected registry.npmjs.org access before verification completed. Full browser
runner was attempted once; sandbox rejected loopback 127.0.0.1. No repeated private
log write or sandbox workaround was used. Full host verification, Chromium clicks,
smoke/real DSH, live models, deployed-service three-role acceptance and independent
review remain Not run for this draft. Tester must request the configured host
verification; operator must rerun full Chromium/backend and criterion 7 acceptance.
Chief alone judges overall completion; no Task close, publication or deployment.

---

# Issue #40 working-tree evidence

Base: `59635b2ab2164da78794301180fb3291a300684e`. This is unsealed working-tree
implementation evidence, not a candidate commit, independent review or CI PASS.
The host owns sealing/publishing. No branch switch, worktree creation, credential
change, PR publication, merge or deployment was performed.

## Current recovery result (supersedes the prior environment blockers)

The resumed Developer ran dependency preparation successfully at pinned HEAD
`59635b2ab2164da78794301180fb3291a300684e`. Implementation remains an unsealed
working draft; the host must create the candidate SHA before independent checks.
The new IPC policy allowed actual Git subprocesses: canonical patch generation,
`check` and `canonical` all passed, including the two newly tracked source files.
Both generated-client checks and `git diff --check` passed. The focused command
`/usr/local/lib/flybot-shared/node --import ./core/test/harness-resolve.mjs --test core/test/project-agents.test.js core/test/workbench-client.test.js core/test/project-access.test.js core/test/authz.test.js core/test/project-harness.test.js`
passed 72/72, including all five SDK process contract tests. These replace the
historical SDK handshake failures below; they are not actual model acceptance.

`TZ=UTC npm run verify` was attempted with the provisioned Node/npm PATH. An
initial attempt encountered blocked npm registry access. An offline attempt found
one unused test variable; it was fixed by asserting the forwarded chunk type.
The subsequent offline run stopped on npm's inaccessible private-home cache
(`ENOENT mkdir .../codex-home/.npm`); no complete verify PASS is claimed.
The deterministic Chromium/backend runner was attempted again and blocked by
sandbox policy on loopback `127.0.0.1`. No sandbox or private-path workaround was
attempted. Tester must request the configured host command with outputs.tests;
its actual success is required before downstream review.

Developer hands off for host sealing and then independent Tester verification.
Full smoke/DSH, completed Chromium/backend, actual model inference, deployed shared
service three-role browser acceptance, CI and independent review remain Not run.
Criterion 7 remains explicitly pending operator evidence and Chief judgement.

## Historical attempts (superseded where noted above)

## Prior recovery recheck

The resumed Developer execution retained the implementation at the same unsealed
base above. Dependency preparation passed again. The combined command
`node --import ./core/test/harness-resolve.mjs --test core/test/project-agents.test.js core/test/workbench-client.test.js core/test/project-access.test.js core/test/authz.test.js`
passed all four file-level tests (exit 0). Both generated-client `--check` commands
and `git diff --check` passed again. These results concern this working tree, not
a sealed candidate SHA.

Actual patch `generate` and `check` were retried once after preparation; both still
failed with `spawnSync git EPERM` (respectively `ls-files` and `write-tree`). The
Git child output was present, but Node reported an error, so neither operation is
claimed complete. No generator bypass or hand-written patch mirror was used.
The SDK process test was also rerun: 2 passed / 3 failed, again before handshake;
its cause remains unconfirmed. Tester must request host-side verification and
report these failures, including whether the unrestricted run reproduces them.
Patch synchronization is still required before a valid sealed candidate. This is
a transfer for verification/environment diagnosis, not completed Developer work.

## Red / green

New room tests in `core/test/project-agents.test.js`, run before source changes using
`/usr/local/lib/flybot-shared/node --import ./test/harness-resolve.mjs test/project-agents.test.js`
from `core/`, produced 23 passed / 2 failed at the pinned base. Both failures were
`Unknown endpoint project-room-create`, establishing the missing capability.
After implementation the same file, with additional boundary tests, passed 28/28.
Tests use real FlyBot services and deterministic native/SDK execution substitutes;
these are not real-model or deployed-service acceptance.

## Ran

From the worktree root, unless specified:

- `/usr/local/lib/flybot-shared/node /srv/flybot-shared/operator/verify-worktree.mjs --prepare-only`: passed, pinned dependencies prepared.
- `/usr/local/lib/flybot-shared/node --import ./core/test/harness-resolve.mjs core/test/project-agents.test.js`: 28/28 passed.
- Same loader with `core/test/workbench-client.test.js`: 7/7 passed (DOM clicks, including room routing, safe Markdown and document access).
- Same loader with `core/test/project-access.test.js`: 11/11 passed (including actual channel dispatch vocabulary).
- Same loader with `core/test/authz.test.js`: 21/21 passed.
- Same loader with `core/test/project-harness.test.js`: 2 passed / 3 failed, all three at SDK runtime handshake before the expected contract. Cause is unconfirmed in this worker; must be rerun/investigated by the host. No passing SDK process evidence is claimed.
- `/usr/local/lib/flybot-shared/node core/scripts/build-client.mjs` and `core/scripts/build-workbench.mjs`: generated successfully; both `--check` commands passed.
- Focused oxlint on changed host/client files and browser runner: exit 0; one existing `no-control-regex` warning in the terminal ANSI stripping expression. No new warning retained.
- `git diff --check`: passed.

## Blocked / Not run

- `FLYBOT_BROWSER_TOOLS=/srv/flybot-shared/browser-tools PLAYWRIGHT_BROWSERS_PATH=/srv/flybot-shared/browser-tools/browsers /usr/local/lib/flybot-shared/node --import ./core/test/harness-resolve.mjs dev/demo/collaboration-browser.mjs`: blocked before browser launch by `listen EPERM 127.0.0.1`. The runner is committed as a replayable deterministic Chromium/backend test, not a completed browser result. Test-created temporary data was removed; no server remained running.
- `/usr/local/lib/flybot-shared/node scripts/ds-bot-patches.mjs generate`: blocked by `spawnSync git EPERM`. The generator did not complete. Generated patch mirrors remain unsynchronized; they must be generated by the host or a properly provisioned successor execution, never hand-edited.
- Same script `check`: blocked by Git `write-tree`, read-only external worktree index (`index.lock`). No patch check PASS.
- `TZ=UTC /usr/local/lib/flybot-shared/node /srv/flybot-shared/operator/verify-worktree.mjs`: blocked before `npm run verify` by `EROFS` opening the wrapper's fixed `/var/lib/flybot-shared/private/verify-….log`. Full verify did not run. Do not alter that path, permissions or credentials from this worker.
- Full smoke/DSH, real SDK/model inference, complete Chromium/backend run, deployed shared-service three-human-role browser acceptance, CI and independent review: Not run / pending. No permission to deploy is inferred.

Chief must judge the verification blockers and outstanding acceptance. The candidate is
not ready to publish or accept until patch generation and required checks pass, and
criterion 7 explicitly remains pending operator evidence. The capability inventory also
states bounded text-only documents, no partial SDK JSON rendering, operator-only global
tree management and deferred cross-instance Social; no broader restoration is implied.

## P0 same-PR integration — 2026-11-01

This execution starts at published candidate `56d14be1221f5d8b3ce9a83f4087abf55b664db2`.
It merges host-pinned upstream `e3ff1d26f28e7c414541f73df5598752d79ca216`
with `git merge --no-commit --no-ff`. Five additive documentation conflicts were
resolved preserving both sides; the automatic Harness source merge retains room
metadata and upstream sandbox/scratch/release changes. MERGE_HEAD remains the
trusted upstream and all resolutions are staged for host sealing. No worker commit,
new PR, credential change or publication was performed.

Ran on this unsealed merged tree:

- Configured verifier `--prepare-only`: passed.
- Client and workbench builds: passed.
- Patch generate, check and canonical: passed after staging conflict resolutions.
- `git diff --cached --check`: passed.
- `PATH=/usr/local/lib/flybot-shared:$PATH TZ=UTC npm run verify`: incomplete.
  Lint, build checks and patch checks passed; core tests progressed through test
  1030 without a reported `not ok` before the tool reported sandbox denial of
  private/loopback network access. This is neither a complete core-suite PASS nor
  full verification. No new defect-test red/green is claimed for this integration;
  inherited regression results are not borrowed as current results.

Not run/completed here: full configured host verification, smoke/Chromium, real
model/shared-service acceptance, independent Review and same-PR publication.
Tester must request the host configured verifier on the sealed candidate. Earlier
logs above remain historical. Owner's polished-demo UI feedback remains outstanding;
this P0 integration does not establish overall #40 completion or visual acceptance.

## Changelog return — 2026-11-01

Rework starts at `28a23819e30cb7a07e14f9d5e255c0ff7aa39c18`, retaining the
existing UI and Task/PR lineage. The actual local fragment check reproduced
`40.fixed.md: one entry per file, no blank lines inside it` (exit 1). Joining
its paragraphs preserves every word and satisfies the existing fragment contract.
No additional host failure log was attached to this handoff; no other failure
is inferred or repaired. The operator-reported Chromium/gateway/backend fixture
passed on that prior candidate, with desktop and 390px screenshots under
`/var/lib/flybot-shared/resources/r7-ui-28a-preview/`. That is historical fixture
evidence for unchanged UI, not a new run, real-service acceptance or Owner approval.
New candidate host verification and independent Review remain required.

Ran on this unsealed two-file rework: configured verifier `--prepare-only`
passed; `node .github/scripts/changelog.mjs check` passed (29 fragments);
`node --test .github/scripts/changelog.test.mjs` passed (7/7);
`git diff --check` passed. Commands used `/usr/local/lib/flybot-shared/node`.
Not run: full `npm run verify`, Chromium, deployment/real-service acceptance
and independent Review. This documentation/fragment-only change leaves core,
client builds and generated patches byte-unchanged. Tester should request the
configured host verification after sealing; no complete-role PASS is claimed here.
