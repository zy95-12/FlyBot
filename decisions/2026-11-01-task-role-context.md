# Keep resident Chief memory and Task-role context at their proper layers

Owner decision,2026-11-01: Chief is a resident Project participant with durable memory; temporary roles have one logical Session per Task and equivalent context handling. Use Codex SDK thread persistence/auto-compaction rather than transplanting DSH history management.

FlyBot owns scoped memory, authority, immutable evidence and Task-role/backend bindings. Reuse original own-Bot MEMORY.md/topics/journal behind Project authorization. Input archives preserve exact sources without placing all history in every prompt. Stable SDK cwd plus matching principal/resource/profile/model/persona permits same-thread rework after confirmed exit; changed bindings rotate physical threads with lineage. Distinct roles/Tasks never share thread bindings. Native DSH keeps its original compactor; per-execution native carriers retain logicalTask identity and retrievable facts.

No memory or model output grants permissions. SDK Chief context/memory exchanges revalidate delegation; read-only/private routes cannot write public memory. Full private logs and source archives are retained. Legacy checkpoint and failed Attempt history remain.

Implement directly in foreground PR47 with tests, architecture and memory. Continue original frontend Task40/PR48 through FlyBot only after backend validation; no new backend Task or PR, no control-plane, merge, resource/model or hosting changes.
