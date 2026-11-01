# Restore scoped native collaboration for issue #40

Date: 2026-11-01. Status: implementation candidate, acceptance pending.
Class: implementation of the owner-authorized collaboration repair scope.

The owner confirmed Chief decision chief-decision-0940a81f-5b34-418f-a62d-185afade8258
covers internal multi-Bot/room/stream adapters with Project/user isolation. This work
uses existing delegated Project agent execution and Task/pool history; it does not
relax authentication, introduce a control-plane change, grant connector credentials,
publish, merge or deploy. Each room/role needs an independent conversation carrier so
a restricted room cannot inherit the public Chief's history. Conversations remain
read-only; impactful work still uses Tasks and their original role policy.

The standalone gateway has no Harness module loader. Preserve the original rich UI
and scoped services; render safe public text in the standalone entry without raw owner
Session APIs. Reuse the original mention parser and role/resource configuration.
Text documents are scoped registrations; arbitrary filesystem and binary access are
not introduced. Cross-instance Social remains deferred as the owner permitted.

Evidence: two room regressions failed at base 59635b2ab2164da78794301180fb3291a300684e
with Unknown endpoint project-room-create, then passed with the implementation.
Model/DSH substitutes in service/browser fixtures are not real-model acceptance.
The worker sandbox blocks loopback access, preventing Chromium/backend execution
here. The operator supplies real shared-service three-role browser evidence after a
candidate deployment; Chief must retain pending acceptance and judge overall completion.

Written-by: Developer

Rework retains the same Task and previous failed evidence. Correcting fixture token
authentication and the installation-order expectation changes no authority contract.
Socket-free channel checks now run in verify; Chromium and deployed-service acceptance
remain independent requirements, not waived by these regressions.


Current rework at seed c9f9b5d6e548ddae8343ac4b1e1a4f0df3ea06e8 reproduces the full bootstrap failure and invalid changelog fragment. The available complete host log verify-9f7840bf-7851-418f-9500-fc8bf6139ecf.log is 1903547 bytes, SHA256 30989f8ce2884717408082c44949872b46ac9b1daea07059898aff41b3aafff6, differing from the handoff hash d592c49d; it records core/plugin successes and the changelog validator failure, not the older install-order failure. Existing failure history is retained. New full verification and actual browser evidence are required independently.


Implementation continuation: Project Chief/private/room replies now share the original reply components and scoped observable source. Multiple room-role streams are rendered independently; route/logout/auth failure clears content. Existing authority and scope are unchanged. Native personal-space/service adapter and visual acceptance requirements remain open.

Written-by: Developer

Native continuation uses the existing AssistantCell/marks and shared observable,
with personal-space capability limited to original owned Bots and authorized local
rooms. Room history follows existing membership windows; personal memory excludes
team scope. This implements existing Owner scope without granting raw Harness or
connector access. The full native shell/composer and deployed visual acceptance
remain outstanding, not implied by this implementation slice.

Task40 interaction continuation reuses original question, approval, member-work,
reply and dictation components through selected-conversation adapters. One-shot
permissions do not create standing grants. Group controls retain native membership
and per-Bot ownership; original routing authority stays host-side. Native own-chat
streams exclude hidden exchanges, and SDK execution inputs keep existing worker
and Project authorization. This records implementation within the accepted scope,
not a new permission, independent approval, deployment or completion decision.
