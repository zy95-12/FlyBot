# M7 execution and acceptance checkpoint

M7 is implemented as five dependent PRs in zy95-12/FlyBot: #26 (role Sessions), #27
(resources/leases), #28 (Harnesses), #29 (Owner setup) and #30 (resource handoff/integration).
Review/merge the full stack in order; no production deployment or merge is performed by
these checks. In particular, the final integration fixes HTTP routing of runtime/terminal/
input endpoints; earlier service tests alone did not exercise that channel.

## Reproduce

Use Node22+ and the existing npm run verify environment. The complete key-free verify
includes existing actual DSH native runtime probes. Docker-capable operator tests run:

```sh
node dev/demo/resources.mjs
node --import ./core/test/harness-resolve.mjs dev/demo/runtime-setup.mjs
node dev/demo/handoffs.mjs
node dev/demo/harnesses.mjs
```

Each resource script creates its own temporary data/container, never an existing
production instance. The last invokes installed official SDKs but deliberately uses empty
profiles and unreachable loopback providers; successful completion must be refused.

The two-account browser regression uses unchanged control-plane and Chromium:

```sh
FLYBOT_DEMO_CONTROL_PLANE=/path/to/unchanged/control-plane \
FLYBOT_DEMO_PYTHON=/path/to/its/python \
FLYBOT_DEMO_BROWSER_HOME=/path/to/playwright/package \
npm run test:demo:browser
```

This exercises real FlyBot HTTP/DSH/browser boundaries with deterministic native model
transport. It includes Owner Harness/resource forms, an actual private target PTY, Member
terminal refusal, nonpersistent audit, release and accurate unavailable SDK status.
No SDK credential or paid model call is required; the fixture cannot prove authenticated
SDK inference, mixed-Harness delivery or real GitHub publication at M7.

## Dedicated authorization still required

Provide resources with the explicit runtime/SDK installation, private profile roots,
Project-owner use grants and separate resource-admin grants for setup. Native uses the
configured DSH model. Dev may select Codex with an authorized model/account, Tester native,
and Reviewer Claude Agent SDK on the other actual resource. Use API/cloud credentials
supported by Claude Agent SDK; do not assume Claude.ai subscription login is permitted.
Codex provider/login must support the actual SDK protocol. Never inherit the current
external Codex conversation or another person's credential profile automatically.

The owner was asked for the dedicated resource/profile source without secret values.
Until that authorization/configuration exists, the following are **Not run**:

- Positive authenticated Codex and Claude Agent SDK code/Chief turns at M7 code.
- Browser terminal→authenticated ready→same-resource real task, with A/B profiles isolated.
- Real mixed three-Harness/two-resource PR delivery, browser return requesting extra tests,
  new commit and exact-SHA re-review/acceptance, forced-failure retry and restart evidence.

These are acceptance gaps, not hidden by mocks, M6 historical evidence or a green unit CI.
Do not close the corresponding issues, mark draft PRs accepted or claim autonomous dogfood
is ready until the checks are run and a sanitized report names the exact executable source.
The general stop/retry/permission/queue/hash mechanisms already have key-free coverage.

## Evidence

The report dev/demo/evidence/m7-2026-11-01.json records the actual source SHA, dependencies,
commands and Ran/Not run after validation. Original M6 live evidence remains separate.
No repository Reviewer PASS, production deployment, automatic merge or exact running-session
cross-host recovery is claimed. Core is canonical; generated patches and docs accompany each PR.

The recorded executable source passed local full verify, 86 focused regressions and the
actual browser/resource/PTY/Git probes. PRs #26–29 passed their Test workflow. The final
PR CI exposed a queue fixture race: terminal Attempt status preceded worker release.
The fixture now waits for confirmed Bot/lease release, and its actual DSH regression
passed locally; CI for that follow-up is pending at report creation. Product cleanup
guards remain unchanged. Do not treat this checkpoint as authenticated SDK acceptance.
