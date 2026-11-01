---
subsystem: fork-validation
owned_paths:
  - .github/scripts/fork-ci-result.mjs
  - .github/scripts/fork-ci-result.test.mjs
  - .github/scripts/test-workflow.test.mjs
  - .github/workflows/test.yml
---

# Fork basic validation

Owner policy: default PR validation installs pinned dependencies, lints/builds, checks canonical generation and runs core plus plugin unit regressions in one job. Heavy M0/M6 browser/runtime, compatibility and packaging checks are explicit extended workflow-dispatch checks. A basic pass does not claim those suites ran or establish UI acceptance. Extended dispatch requires all extended jobs to pass; failure/cancellation cannot become a pass. UI changes still require actual demo screenshots/clicks, authorization changes their relevant negatives, and independent substantive Review. Preserve exact-SHA evidence reuse and no-merge authority. The fork was observed PUBLIC with empty rulesets/unprotected targets; inherited required-check prose is not platform enforcement. Host verification command policy is separate configuration and remains tracked.

Workflow-shape regressions require the basic job on every event, explicitly dispatched extended jobs, and all three actual job results plus the dispatch flag wired to the executable result gate. They no longer require the historical all-jobs shell expression. The gate regressions separately reject failed/cancelled basic jobs and any omitted extended job during extended dispatch.

The tests-ok aggregation job checks out its exact workflow revision before running the local aggregation script. Default basic CI runs both the aggregation truth table and workflow policy regressions; the latter distinguish always-run basic tests from explicitly selected extended plugin/package jobs. Old inherited assertions that every heavy job runs on every event are superseded by the owner-approved policy, while failed/cancelled active jobs still cannot pass.
