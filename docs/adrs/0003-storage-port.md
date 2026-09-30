# ADR-0003 — Implement pi's `Storage` port rather than forking session internals

**Status:** Accepted

**Context.** `pi-agent-core` exposes `interface Storage` (10 methods) at
`harness/session/types.d.ts:386`, ships a conformance test suite, and already
has multiple implementations (jsonl, in-memory, gating, instrumented,
benchmark). `IdGenerator` is injectable too. Third-party backends are an
expected extension point, not a hack.

**Decision.** Write `KynetaStorage implements Storage`. Validate against pi's own
conformance suite in CI.

**Consequences.** `Storage` becomes our single deep coupling to pi — the surface
to watch on upgrade. If we also bind to `AgentLane` internals, that surface
doubles; avoid. Correctness is checkable against someone else's tests, which is
unusually good leverage.

**Alternatives rejected.** *Fork `session-manager`* — that is the legacy
pre-v4 path being replaced. *Project Kyneta from JSONL* — leaves a file as
source of truth under a CRDT, defeating the purpose.
