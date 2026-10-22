# S325 — What grows the observer to its 512 MiB limit?

- **Status:** Open

**Question.** The observer's container (`OBSERVER_GRANT`, 512 MiB) was
killed for memory on 2026-10-21 in the person's lane VM, and in the lanes
suite's `shared` scenario. What does its process hold as it grows: the
held notices of lanes whose host is gone (`HELD_PER_LANE`, 100,000 a
lane), the output rings, the loader's maps, or Node's heap? Does it grow
with a workload's file events, its runs, its lanes, or its hosts'
reconnects? Is it held or garbage (a forced collection's `heapUsed`, as
S191 sampled the host's)?

**Kill criterion.** The belief is that a bound the observer documents
(`planHeld`'s, `HELD_PER_LANE`) admits more than 512 MiB. It is wrong if
the growth follows no documented bound, which would name another cause;
the spike then says what it saw.

**Throw away.** The probe and its workloads; kept in its folder of
sources only if a plan builds on them.
