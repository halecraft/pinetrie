# ADR-0212 — Under memory pressure, lanes wait at their gate on every backend; the rest of the ladder is measured before it is built

- **Status:** Accepted (Duane, 2026-10-22)
- **Area:** `packages/machine/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S309, S316, S317, S318, S319, S323, S329
- **Amends:**
  - ADR-0210: of its memory ladder, holding starts and pausing at the gate are
    built now, on every backend; squeezing, freezing into zram and killing are
    planned and recorded but not done, until a record of real use (S328) says
    whether they are needed.
- **Revised:**
  - 2026-10-22: a host inside a lane reads its available memory as its limit
    less its use *but its inactive file pages*: page cache fills a cgroup to
    its limit with no pressure, so the limit less the use reads almost nothing
    left on a calm lane and would enter rung 3 (S329).

**Context.** ADR-0210 decided a ladder of six rungs (calm, squeeze, hold
starts, pause at the gate, freeze into zram, kill one command), all to be
built. It rested on synthetic loads (S309, S316–S318) and one incident that
ran beside a disk filling with 36,000 subvolumes. Since then the disk upkeep
keeps the store small, and every host samples real pressure (`psi=1`, the
health value). How often real use reaches each rung is not known.

The rungs differ. Holding starts and pausing at the gate use mechanisms
that exist and were measured (S319), touch no kernel state, work alike on
the lane VM, a Linux host and a nested lane, and are what a repair needs to
keep lanes waiting while the lane VM is down. Squeezing mostly does early
what the kernel's reclaim does anyway, unmeasured under real pressure.
Freezing into zram exists only where pine·trie owns the kernel (the lane VM),
needs the privileged role to write lanes' cgroups (S323), and brings
thaw-before-stop; killing reaches the agent as a failed call. pine·trie runs
on machines of every size, on the Mac and on Linux: the machine's memory is
given, and pine·trie must work within it, not ask for more.

**Decision.**

- **Rungs 2 and 3 are built, on every backend.** The rung is planned from
  the machine's pressure (PSI where the kernel has it, available memory
  where it does not), as ADR-0210 says; rungs 2 and 3 have bounds of both
  kinds, so a kernel without PSI still holds. The machine is what its lanes
  share: for a host inside a lane, its own cgroup (its `memory.pressure`, and
  its limit less its use), not the lane VM's whole, whose pressure is other
  threads' too. Each sample records which it read. At rung 2 a run that would start, or
  a lane that would wake, waits in its queue; at rung 3 the least important
  running lanes wait at their gate before their next tool call. Each lane's
  treatment is a value the record publishes, and the gate and the start wait
  on it: a hold is the treatment, so nothing releases it but the next plan.
- **Rungs 1, 4 and 5 are planned and recorded, not done.** The same planner
  computes what squeezing, freezing and killing would do, and records each
  as a decision not taken: which lane, what it would free. So when evidence
  calls for one, the code that acts is the code that was measured.
- **A record of the machine, kept and exportable.** Every sample, on every
  backend: the rung, pressure, available memory, the kernel's refaults and
  stall time since the last sample, lanes running, the backend and the
  machine's memory, the manager's mode. Every running lane: its memory
  (`anon`, `file`, current, limit) and the first word of the command in
  flight, never its arguments or output. Every finished tool call: its
  command's first word, its lane, its duration. Every hold, pause and
  release, with the memory and pressure before and after, and every shadow
  decision. Kept in bounded tables in the host's SQLite file for a fixed
  number of days, and exported with the Machine page's diagnostics.
- **S328 reads that record** from real use on the Mac and on a Linux host:
  how often each rung's threshold is crossed, at how many lanes, by what,
  whether a hold relieved pressure, and what the shadow decisions would have
  freed. It sets the thresholds, and whether squeezing, freezing and killing
  are built, each by an ADR of its own.
- **One cause for memory.** The health value's `memory-stalls` becomes a cause
  carrying the rung and the lanes held, worded by rung and by mode: in
  observe mode, memory is short, with nothing done.

**Consequences.**

- Under pressure, lanes beyond what fits wait, said in their columns and the
  footer, on the Mac and on Linux alike; nothing is frozen or killed until
  evidence asks for it, so a lane under pressure on a small machine may
  still thrash at the gate's pace rather than be stopped.
- A repair (ADR-0210) holds every lane by the same treatment value.
- The host keeps a few days of samples: a few million small rows at worst,
  bounded, holding no command's arguments.
- ADR-0210's zram, the privileged role's cgroup writes and thaw-before-stop
  are not built; S318 and S323 stay their evidence.

**Alternatives rejected.**

- **Building the whole ladder now** (ADR-0210 as written): its riskiest rungs
  rest on synthetic loads; the record answers whether they are needed.
- **A larger lane VM**: one person's tuning on one Mac; on Linux there is no
  VM, and in a nested lane the memory is the outer lane's limit. pine·trie
  works within the memory it is given.
- **A record in the log alone**: gone at a restart, and holding no outcomes,
  no shadow decisions and no lane's memory by command, it could not set a
  threshold.
