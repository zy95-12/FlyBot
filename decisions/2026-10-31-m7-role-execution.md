# Keep Chief identity durable and instantiate task roles through selectable Harnesses

Date: 2026-10-31 (Asia/Shanghai). Class: major. Status: accepted fork scope.

The fork owner proposed a resident Project Chief, temporary Dev/Reviewer/Tester Sessions,
role persona/memory/task assembly and selectable multiple execution resources plus native,
Codex SDK or Claude Agent SDK Harnesses. The owner accepted issues #20–#25 and explicitly
requested sequential implementation, one PR each, updating memory/docs/tests.

Execution resources mean authorized runtime environments; multiple selection is a candidate
pool with a sticky single-resource lease per Session. Model/provider credentials are separate.
The existing Workflow owns Task/Run lifecycle. Public role memory is explicit human publication;
private notes/raw temporary transcripts cannot be automatically promoted. Configuration changes
apply only to new Sessions; old Attempts preserve their snapshots and evidence.

M7.1 implements definitions/memory/context/session boundaries. M7.2–M7.5 supply resource
leases, SDK execution, authorized setup terminal and actual mixed-resource acceptance.
This authorizes development in the fork, not production deployment, merge, arbitrary host
shell access, implicit reuse of another user's SDK login or relaxation of acceptance gates.
Control-plane remains unchanged. No upstream participant or independent review is claimed.

References: https://github.com/zy95-12/FlyBot/issues/20 and child issues #21–#25.
No dissent recorded. Written-by: Codex


### M7.2 — 2026-10-31

M7.2 implementation uses operator-configured local/Docker capabilities and the existing Project queue. Unknown workers retain leases after restart; credentials and environment readiness remain separate observations. Explicit platform instance association cannot confer remote-execution capability.


### M7.3 checkpoint — 2026-10-31

M7.3 connects temporary SDK workers through the existing Workflow lifecycle; explicit resource/principal profiles replace ambient login inheritance. Public Chief SDK turns use a host-validated typed action boundary with generic tools disabled; definition changes rotate backend bindings. Real authorized SDK acceptance remains separate from negative/contract tests.


### M7.4 — 2026-10-31

M7.4 chooses authenticated HTTP polling for the first resource terminal; every WebSocket upgrade is refused. Resource admin authority is explicit and separate from Project ownership. Profile secrets are saved with hidden input only on the granted target; native DSH requires its actual operator-registered profile. Real paid probes remain explicit/bounded.
