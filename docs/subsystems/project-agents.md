---
subsystem: project-agents
owned_paths:
  - core/src/host/project-agents.js
  - core/src/host/project-agent-skills.js
  - core/src/host/project-role-context.js
  - core/src/host/project-credentials.js
  - core/test/project-agents.test.js
  - core/test/project-credentials.test.js
---

# Public roles and private Project agents (fork M4)

Project has public Chief/Developer/Tester/Reviewer definitions and a separate private
agent identity for each `(host memberId, projectId)`. Human Project roles still decide
permissions; a Chief/Reviewer label grants no human authority. Current membership and
session validity are checked on every scoped tool operation.

## Identity and storage

`projectAgents` holds logical identities and current Bot/Session carriers. Private keys
are derived from Project/member IDs; replacing a missing Bot does not change the logical
identity, private notes or transcript key. Each private Bot has the human as owner and a
Project binding. Public Chief is a new shared Session. Existing owner-only Project Chief
sessions remain in `legacyChiefs`, with their original private context; they are never
silently promoted into public shared history. New workbench Projects create scoped
agents instead of scheduling legacy private-assistant digests.

| Data | Scope | Host storage |
| --- | --- | --- |
| Public role/persona/model/skill definitions | current Project members | projectAgentDefinitions |
| Shared facts/decisions with author | current Project members | projectKnowledge |
| Public Chief channel | current Project members | projectAgentTranscripts[public identity] |
| Private notes/conversation | one human in one Project | projectAgentMemory / projectAgentTranscripts[private identity] |
| Unpublished Task proposal | its proposing human only | projectAgentProposals |
| Code role instances/evidence | existing versioned Project Attempt | M3 workspace/Run/Attempt stores |
| GitHub write attribution | Project operation audit | projectGithubWrites / Attempt.pr |

`project-agents {projectId}` returns only the caller's private identity, notes and
proposals, plus the shared definitions/Chief/facts. Caller-supplied agentId/memberId
cannot select another private identity. `project-agent-history` similarly derives the
private identity from the actor. A public context tool never returns any private table.
A private context includes shared facts and that identity's own bounded notes/history.

`project-knowledge-write` records explicitly shared facts/decisions with their author.
Private notes use `project-agent-memory-write` or the private agent's memory tool; these
never write shared knowledge. Private Task proposals remain private until their human
calls `project-agent-proposal-apply`, an idempotent explicit publication of the displayed
fields. No private conversation is copied automatically to the public Chief or Task.
Existing authorized shared Tasks can be executed by a private agent without publishing
private content. The public Chief can create a Task from its current public requester.

## Delegated execution boundary

`project-agent-message {projectId,visibility,text}` derives the identity and records
explicit human input. One live human delegation per agent turn prevents another user's
request from overwriting the actor while a public Chief is answering. The delegation
contains the trusted session and definition revision, not body claims. A matching observed message/turn activates the delegation; the delivery layer checks its
ID before queuing, and cancellation removes that exact queued exchange. Busy agents
return bot/busy. A reply/transcript records the initiating human, actual Bot and definition
revision; public and private logs remain separate.

The model receives only `project_agent_context`, `project_agent_memory`,
`project_agent_task` and `project_agent_run`. Server guards refuse all other tools,
including filesystem, network, generic team and connector tools. Tool masks reflect this
when DSH can hide the tool; guards still refuse agent-local names that cannot be hidden.
The capability is bound to the current own Session. Group/historical Sessions cannot
reuse it, and Project agents cannot be added to groups through roster or participant APIs.
Public Chief is not reachable through the legacy private send/history API.

Every scoped operation checks the current delegation, human membership and session.
With platform identity, it revalidates the existing upstream session API; a revoked,
suspended or substituted subject fails closed. A changed delegation after an async
validation cannot be used. Local session revocation and Project member removal cancel
chat delegations immediately. Accepted code work remains under Project authority,
as defined in M2; chat revocation does not secretly cancel unrelated code workers.

Archive preserves existing historical read access but refuses new agents/shared Task
creation. Delete first archives/blocks new work, retires scoped agents and clears their
private notes/transcripts, while retaining the public discussion and role definitions
beside the Project tombstone. Partial deletion stays archived and can be retried. No
new agent can be recreated for a deleted Project. M1/M3 still refuse unfinished work.

## Role definitions and skills

Owner/Maintainer may configure a public role's persona, served model reference and skill
names. Built-in planning/code/testing/review skills have explicit instructions and hashes.
Existing capability-library skill content is reused only when the operator names it in
`projectSkillAllowlist`; private/global library contents are not enumerated or inherited
into shared context. Unavailable skill/config changes fail before mutating the definition.

M3 records the complete definition revision, role/model/persona and resolved skill content
on the next Attempt. Running Attempt definitions remain immutable. Persona/skill changes
do not change server permissions. Public Chief updates apply at its next message; the
core scoped instructions remain present. Worker role policy still uses the registered M3
cwd, independent tests and commit gates. It does not claim OS/container isolation.
Connector declarations stay refused; external writes use the explicit host broker below.

## GitHub identities

Project code publication uses `projectRepositories[repository].github` as explicit
Project automation. Personal comments use a different exact mapping:

```yaml
personalGithub:
  host-member-id:
    project-id:
      credential: gh-cli
      configDir: /operator/alice-project-gh
      login: alice-github-login
```

A credential source requires an explicit absolute config directory. Ambient GH_TOKEN /
GITHUB_TOKEN values are removed before looking it up. The selected token is verified
against GitHub /user and any configured login; push clears inherited auth headers before
supplying the selected credential. Tokens stay in host memory/environment for the narrow
operation, never Bot context, command arguments, persisted state or frontend responses.

`project-credential-status` reports only configuration status and the caller's personal
login; it does not claim a configured credential was verified. `project-github-comment`
uses only the authenticated caller's exact personal Project mapping. Body scope/user/
credential references cannot select Project automation or another person's credential,
and Owner authority cannot override this. Missing/mismatched credentials fail explicitly.
Immediately before posting, platform session and current Project write rights are checked
again. The audit records initiator, actual/selected GitHub login, scope, URL, body hash and
identity verification. A response mismatch is recorded for reconciliation and refused.
Project PR metadata similarly records the actual executor login and automation scope.
No personal GitHub write is exposed as an unrestricted model connector.

## API and verification

New APIs: project-agents, project-agent-message/history/memory-write/definition,
project-agent-proposal-apply, project-knowledge-write, project-credential-status and
project-github-comment. They are behind the explicit Project workbench mode and the
same platform/member authorization boundary. Existing legacy mode remains separate.

Agent tests cover private pair identity, cross-user/project reads, proposals and actor
attribution, busy/public delegation, member/session revocation, group/old Session denial,
carrier replacement, skill configuration and deletion privacy. Credential tests cover
exact human/Project selection, ambient-token refusal, actual-login binding, no fallback
and revocation before an external write. M3 tests continue to cover pinned role snapshots.

`npm run test:demo:runtime` includes an actual DSH `--agents` probe: two private agents
call real scoped tools, private notes remain separate, a private proposal is published by
its human, public Chief creates a Task as the current requester, and removal refuses old
Session/history access. It uses a deterministic model, not a real-model acceptance claim.
The selected real automation account was also read-only verified as zy95-12; tests do not
claim two real personal GitHub identities or personal writes were exercised. The unchanged
control-plane shared probe remains a separate integration check.

Privacy here is enforced on FlyBot's scoped API/tools. M3 code workers retain the existing
host execution preset and no OS sandbox is claimed. Shared browser delivery also needs a
restricted gateway that keeps the outer DSH owner credential and raw DSH Session APIs away
from members; M5/M6 implement/test that entry. This is a trusted-input collaboration demo,
not a claim of hardened hostile-code multi-tenancy or encrypted server-side storage.

### Real-model integration findings

Scoped tools serialize their structured return as JSON under the declared string output
schema. Rendering an object with String(value) loses facts/Task ids as `[object Object]`;
real agents may retry an otherwise successful creation. Regression coverage checks the
model-visible render, not only the internal service result.

Within one live human delegation, repeated concurrent task-tool calls with the same
normalized title reuse the first Task/proposal and preserve its original criteria. The
key binds agent identity, delegation and title; a new human request can intentionally
create another Task. Authorization is rechecked inside the serialized mutation. Private
proposals remain private and still require separate human publication.

Carrier names place a digest of the logical identity before a short Project label, keeping
uniqueness within the host's 40-code-unit limit. Long equal Project names cannot truncate
away the human/Project discriminator; replacing a carrier preserves the logical identity.

The integrated [real-provider acceptance](../live-acceptance.md) confirms actual models read
their own JSON context, acknowledge private notes and create one shared Task as the current
human. It exposed and verifies the truncation/serialization/idempotence fixes above.


## M7.1 — persistent definitions and memory, replaceable execution Sessions

`projectAgentDefinitions` remains the public role registry. Each role now carries explicit
`memoryRefs` and `execution {harness, resourceIds}` references, including Chief. Existing
records without these fields retain native execution defaults. Non-native/unprovisioned
selection fails closed until the following resource/Harness phases implement dispatch.
No configuration field grants filesystem or human authority.

`projectRoleMemory` is public, explicitly published by a configuring human through
`project-role-memory-write`. A record is scoped to exactly one Project and role, with
revision, human source/reference and prior published versions. Cross-scope/missing refs
are refused before configuration changes. Private notes, transcripts and proposals are
never a source. No execution transcript is automatically promoted to long-term memory.
Owners can explicitly publish verified experience and cite its source.

A Chief turn freezes persona, Skills, referenced memory, public knowledge and registered
repository instruction excerpts into `lastRequest.context`. Its hash/version/source refs
remain with the request. Chief has no idle inference timer; incoming human messages use
the existing delegated inbox/turn machinery. Logical identity/history survive carrier
replacement. Completion is recorded, and late callbacks without an active matching
Session/delegation cannot append messages. New configuration affects the next turn.

Delivery snapshots use the same assembler, with Task criteria and prior Attempt feedback.
The context is capped at 48,000 characters and rejects overflow. Repository AGENTS,
PROJECT, ROADMAP and LESSONS are read from Git at an explicit commit, each capped at
6,000 characters with truncation flag, full-content hash and original size. Context is
JSON fenced with angle brackets escaped. Public inputs are task data, never permissions.
The host inserts the snapshot after the Workflow graph's 4,000-character prompt boundary;
actual DSH runtime assertions check the model request contains memory and repo content.


### M7.2 — 2026-10-31

M7.2 validates role resource references against operator grants before saving configuration. Optional maxConcurrent limits the configured role pool; new settings do not mutate saved Attempt/Session snapshots.
