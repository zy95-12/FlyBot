# Repair native collaboration and use Bot task pools with handoff

Date: 2026-11-01 (Asia/Shanghai). Class: major. Status: accepted scope; implementation and acceptance are separate.

The fork owner authorized sequential implementation of [#33](https://github.com/zy95-12/FlyBot/issues/33), issues #34–#41, one implementation PR per issue, with repository memory, matching architecture and tests. The first repair PR stacks on the fetched M7 integration branch because main still contains only M0; subsequent dependent branches identify their actual parent explicitly. This is not permission to merge or weaken review gates.

Reuse the original rich chat, multi-Bot interaction and Project-scoped adaptations. Each logical Bot owns its task pool and may accept, return or transfer work. Normal downstream handoff goes directly to the receiving pool. Completion or uncertainty goes to Chief for judgement; fixed DAG is an optional template, not the default dispatcher. Conversation handoffs do not create Tasks. Code changes, adopted technical decisions, merges and releases use corresponding Task contracts.

Restore the effective Dev/Reviewer/Tester development and verification conventions, with versioned sources and actual evidence. Safe personal-agent mode asks before publishing impactful Tasks; watch mode acts with the user's full current authority, revocable and audited. Current account/Project/resource authority and existing repository gates continue to apply.

Chief inspection is a configurable scheduled task using FlyBot schedules. A project template may default to 30 minutes; cadence, content, thresholds and enable/disable are configuration. Do not hardcode a Chief-specific 30-minute framework loop. Schedule targets a durable logical Chief/Project, not a temporary SDK Session.

Public URL/domain/TLS/tunnel work is explicitly deferred. Keep control-plane unchanged. Preserve current Task/Attempt and failed-session evidence. Do not treat smoke checks or mock SDK/clock results as actual shared-service acceptance. No production change or automatic timer registration follows from this document.

Written-by: Codex
