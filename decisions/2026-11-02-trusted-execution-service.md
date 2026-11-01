# Trusted private service execution

Owner accepted staged implementation of fork #49/#54. Reuse one dedicated service
account and explicit local/Docker profiles for this trusted private single-host
deployment; separate per-Bot users/containers are not required.

Human authorization, Bot contracts, Harness capability and OS isolation differ.
Shared UID/cwd wrappers do not provide hostile-code isolation. Safe/watch/current
principal, personal credential, private memory, lease/generation/exit/workspace and
exact-SHA acceptance contracts remain mandatory.

`trusted-private-single-host/v1` is the compatibility default; unsupported explicit
profiles fail repository/resource admission. A read-only query reports current
metadata without granting rights or running tests/SDK probes. This implementation
does not change live accounts, credentials or sandbox settings. Stronger isolation
needs a separate scope when untrusted workloads are actually admitted.

Implementation/evidence: #54 PR and [boundary contract](../docs/subsystems/project-execution-boundary.md).
