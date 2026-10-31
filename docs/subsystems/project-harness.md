---
subsystem: project-harness
owned_paths:
  - core/src/host/project-harness.js
  - core/src/host/project-harness-turn.js
  - core/src/host/project-harness-worker.mjs
  - core/test/project-harness.test.js
  - core/test/project-harness-turn.test.js
---

# Harness adapters (fork M7.3)

The existing Workflow retains dispatch/result/deadline/release behavior. Its host seam
`projects.execution` delegates configured SDK workers; native roles continue through the
existing Bot adapter. No duplicate scheduler, Task state machine or acceptance rule.

Pinned dependencies: @openai/codex-sdk 0.166.0 and @anthropic-ai/claude-agent-sdk 0.3.316.
Official interfaces: [Codex SDK](https://developers.openai.com/codex/sdk/),
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript).
The latter is the official Claude Code programmatic SDK, not the Messages SDK.

## Explicit identity and configuration

Each resource may define a principal/Harness profile under `profiles[ownerMemberId][harness]`:

```yaml
profiles:
  owner-1:
    codex:
      home: /srv/profiles/owner-1/codex-home
      configDir: /srv/profiles/owner-1/codex-config
      model: your-authorized-codex-model
      envRefs: {CODEX_API_KEY: FLYBOT_OWNER_CODEX_KEY}
    claude-agent:
      home: /srv/profiles/owner-1/claude-home
      configDir: /srv/profiles/owner-1/claude-config
      model: your-authorized-claude-model
      envRefs: {ANTHROPIC_API_KEY: FLYBOT_OWNER_CLAUDE_KEY}
      maxBudgetUsd: 1
```

Paths/models and env *reference names* are operator capability settings, not browser
supplied credentials. Values never enter saved worker/Task records. The worker receives
only a clean environment plus this selected profile over stdin, never process arguments.
No ambient HOME/CODEX_HOME/Claude login, external Codex conversation or model-route
fallback. Local selected resources are currently supported; remote Workspaces/SDK runtime
installation are the M7.5 boundary. Profile runtimeDir may explicitly locate the FlyBot
installation in the target environment. An environment probe is not an auth probe.

## Turn and process contract

One temporary SDK worker maps to one existing Workflow node and one resource lease.
Saved worker evidence names Project/Task/Attempt/role/Harness/version/resource/principal,
lease generation, cwd, backend Session/thread and event log. Input continuation resumes
that backend Session in the same bound cwd. New Attempts create fresh workers/threads.

Codex uses streamed events, read-only/workspace-write sandbox by role, network/search
disabled and approvalPolicy=never. The exec SDK does not provide an interactive approval
callback; denied actions must fail or be explained through a same-thread message. It does
not silently grant full host permissions. Claude uses explicit tools, settingSources=[]
and its permission callback. Permission requests appear as waiting-input and require a
current configuring human's decision; message continuation requires Task write rights.
Both are fenced by worker id/generation and current Project authorization.

A completed SDK turn must contain required OUTPUT ports before Workflow advances.
Otherwise its result is a waiting-input message, not a fabricated successful step. Truncated,
failed or aborted streams do not complete. Workflow still invokes host seal/test/Review/
PR-head/human gates. SDK completion is never acceptance.

The parent saves redacted JSONL events and usage, discards raw stderr except byte counts,
and persists no stdin or profile environment. Known credential values and common key tokens
are redacted. Worker shutdown confirms process exit before releasing its matching SDK lease.
Unknown/failed stop retains capacity; restart does not auto-launch or resume a worker.
Native release remains unchanged. Late callbacks require the same active lease generation.

## Acceptance still pending

Chief remains native at this implementation checkpoint: selecting a non-native Chief
fails closed rather than exposing generic filesystem/connector tools to a public Chief.
The role stores unified execution refs, but a safe SDK Chief tool bridge is not yet shipped.
Remote SDK dispatch and the Owner setup UI/probes follow in M7.4/M7.5. These gaps keep
#23 open and its PR draft until implemented and accepted; do not present all M7.3 as done.

Unit tests inject SDK event iterators and a separate real Node JSONL contract worker to
check environment binding, continuation, failure/truncation, permission callbacks, evidence
redaction and exit-confirmed release. `node dev/demo/harnesses.mjs` invokes both installed
official SDKs with empty isolated profiles/unreachable loopback providers and confirms no
successful completion. These are negative/transport tests, not paid authenticated inference.
The three real-provider and mixed-role checks belong to the explicit M7 acceptance run;
missing credentials must remain Not run, not replaced with mocks.
