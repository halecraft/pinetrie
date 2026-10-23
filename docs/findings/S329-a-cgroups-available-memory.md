# S329 — A cgroup's limit less its use reads as no memory left while it holds only page cache; less its inactive file pages, it reads as what reclaim would give

- **Status:** Answered
- **Led to:** ADR-0212

**Question.** A host inside a lane reads its own cgroup as the machine
(ADR-0212), and the plan read its available memory as `memory.max` less
`memory.current`. Rungs 2 and 3 enter on either bound, PSI or available.
Does `memory.current` stand for memory the cgroup's work needs, or does
page cache fill it with no pressure?

**Kill criterion.** If a cgroup that only read and wrote files shows
`memory.current` near `memory.max` while its `memory.pressure` is calm,
the limit less the use is no measure of room, and the available bound
must leave reclaimable cache out.

**Throw away.** Nothing kept: the probe is the two commands below, run in
the spike VM (S308's harness, `psi=1`).

## Answers

Measured on 2026-10-22 in a `node:24-trixie-slim` container with
`--memory 512m`, reading its own `/sys/fs/cgroup`.

| moment | `current` | `inactive_file` | `anon` | `max − current` | `max − (current − inactive_file)` | `full avg10` |
|---|---|---|---|---|---|---|
| fresh | 3.7 MiB | 0.1 MiB | 0.4 MiB | 99% | 99% | 0.00 |
| after writing 900 MiB to `/tmp` | 511 MiB | 504 MiB | 0.4 MiB | 0.1% | 99% | 0.00 |
| after reading it twice | 512 MiB | 504 MiB | 0.4 MiB | 0.1% | 99% | 0.00 |
| 12 s idle after | 511 MiB | 504 MiB | 0.4 MiB | 0.1% | 99% | 0.13 |

1. **Page cache fills a cgroup to its limit and stays**, with no pressure:
   the kernel reclaims a cgroup's cache only when a charge meets the
   limit. S316 saw the same in a lane: 514–595 MiB of `file` held idle
   after its work.
2. **So `max − current` reads 0.1% left on a calm lane**, under rung 3's
   5% and rung 2's 10%: a host in a lane would hold its lanes after any
   build that read its files.
3. **`max − (current − inactive_file)` reads 99%**, what reclaim would
   give back first: the rule `docker stats` uses for a container's use.
   `/proc/meminfo`'s `MemAvailable`, the machine source's, counts
   reclaimable cache already.
4. **Not measured:** the same rule under anon pressure; a second probe's
   allocation exited before it was read. S328's samples, which have PSI
   beside it, say whether it tracks pressure.
