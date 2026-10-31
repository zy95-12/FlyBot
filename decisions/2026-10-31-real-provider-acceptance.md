# Complete real-provider shared demo acceptance

Date: 2026-10-31. Decision-maker: the fork owner, who explicitly supplied an official
DeepSeek credential and requested completion of validation. Implementer/verifier: Codex.
No independent repository Reviewer verdict or merge authorization is inferred.

Use the credential only in isolated test process input/environment. Reuse unchanged pinned
control-plane; select the already authorized fork and explicit gh configuration for draft
artifacts. Run real model, browser, code/tests, Review, GitHub, human-role return/retry/accept,
negative host-test, queue, revocation and cleanup. Fix observed integration defects in the
existing M6 PR, update architecture/memory/tests, preserve the one-implementation-PR-per-stage
contract and publish sanitized evidence.

The integrated run passed at f126f8cb62c0298b37c46b68f3f8221c8e8f9441. See
[acceptance record](../docs/live-acceptance.md). The real-provider configuration blocker
recorded in earlier M3/M6 decisions is resolved for this demo. Artifact PRs #17–#19 stay
draft/unmerged; milestone implementation PRs can proceed to review. This is not approval
for production deployment, automatic merging, key persistence or unrelated external writes.
