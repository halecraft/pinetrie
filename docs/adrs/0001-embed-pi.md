# ADR-0001 — Embed `pi-agent-core`; do not use chord or the experimental server

**Status:** Accepted

**Context.** pi 0.85 is mid-rewrite into a distributed architecture:
coordinator → replaceable server → one worker process per session → N attached
clients, with a Radius relay for remote. It is real and it works (verified by
running it). But it is hidden behind `PI_EXPERIMENTAL=1`, undocumented, absent
from the CHANGELOG, and moves in lockstep across seven packages. Its state
replication (`chord.ReplicatedState`) is single-authority, which is precisely
what we need to replace.

**Decision.** Embed `@earendil-works/pi-agent-core` directly in our own Node
host. Do not depend on chord, `pi-server`, `pi-client`, the coordinator, or the
session worker.

**Consequences.** Fewer moving parts; no dependency on an unreleased hidden API;
we own the replication boundary. We forgo pi's session/plugin plumbing and its
presentation-plugin system, and must build host lifecycle ourselves.

**Alternatives rejected.** *Build on the experimental server* — we would inherit
a single-authority replication layer and then fight it. *Fork pi wholesale* —
unbounded maintenance against a fast-moving project.
