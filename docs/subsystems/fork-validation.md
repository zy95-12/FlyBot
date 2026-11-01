---
subsystem: fork-validation
owned_paths:
  - .github/scripts/fork-ci-result.mjs
  - .github/scripts/fork-ci-result.test.mjs
  - .github/workflows/test.yml
---

# Fork basic validation

Owner policy: default PR validation installs pinned dependencies, lints/builds, checks canonical generation and runs core plus plugin unit regressions in one job. Heavy M0/M6 browser/runtime, compatibility and packaging checks are explicit extended workflow-dispatch checks. A basic pass does not claim those suites ran or establish UI acceptance. Extended dispatch requires all extended jobs to pass; failure/cancellation cannot become a pass. UI changes still require actual demo screenshots/clicks, authorization changes their relevant negatives, and independent substantive Review. Preserve exact-SHA evidence reuse and no-merge authority. The fork was observed PUBLIC with empty rulesets/unprotected targets; inherited required-check prose is not platform enforcement. Host verification command policy is separate configuration and remains tracked.
