# CI browser runtime compatibility

On 2026-10-31, the M7 PR Test runs passed core/plugin/package checks but failed before
browser execution: ubuntu-latest now selects 26.04, and the locked Playwright 1.56.1
installer refuses ubuntu26.04-x64. Evidence: Test run 41210952538, job 124565620916,
M6 browser step. The other M7 runs showed the same failed browser-install step.

Pin only the browser-bearing Test job to ubuntu-24.04, retaining Node24 and actual DSH
0.2.1-rc.2. Keep the Chromium installer, two-account browser, foreground demo lifecycle,
platform unchanged-source assertions and required tests-ok aggregator. Plugin/package
jobs remain on their existing runners. Do not skip checks or change merge gates.

This compatibility fix is carried first on M7.1 PR #26 and merged forward through the
existing M7 feature branches, preserving one implementation PR per issue. It changes
CI/docs only; milestone executable code and previous local validation stay attributable
to their recorded source commits. Fresh CI at every new PR tip is tracked separately.

Written-by: Codex

The historical Test job display name is a required-check compatibility contract and
remains unchanged. Actual OS/DSH pins are runs-on and the action input; changing the
label alone breaks core/test/dsh-pin.test.js without improving runtime compatibility.
