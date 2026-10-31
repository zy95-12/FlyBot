---
subsystem: project-github-read
owned_paths:
  - core/src/host/project-github-read.js
  - core/test/project-github-read.test.js
---

# Scoped Project GitHub reads

`project-github-read {projectId,operation,number?,scope?}` supports issues, pulls,
pull details, reviews and checks. The host derives the repository from the current
Project, never a model URL/repository. Lists are bounded to the first 20 entries
and explicitly report incomplete pagination. Details and checks name the full PR
head SHA; summaries include source URLs, read time and executor identity.

Shared reads select only explicitly provisioned Project automation credentials;
explicit personal reads select exactly the current human/Project profile. There
is no ambient or cross-human fallback. The selected login is verified; current
Project/platform authority is checked before external operations and after data
returns. Credentials and raw connection responses are never returned to models.
These are read operations and grant no write/merge/release capability.

Native agents use `project_agent_github`. SDK Chief can request bounded host reads
with `github_read` actions; host-confirmed results are appended separately from the
model narrative. A model action or prose is not evidence that a read or write ran.
