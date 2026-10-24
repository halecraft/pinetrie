# S335 — Global reclaim tells the lane VM short of memory apart from one cgroup stalled at its own limit: it rose in every sample of a shortage and in none of a cgroup's own stall

- **Status:** Answered
- **Led to:** ADR-0212

**Why.** The gate's rung reads the VM's `/proc/pressure/memory` and the
share of memory available, and enters a rung when any bound it names is
over (`rungReading`, `packages/machine/rung.ts`; `RUNG_BOUNDS`: rung 3 at
`full avg10` over 10% or available under 5%). PSI counts a task's memory
stall in its own cgroup and every ancestor, the root's included, whatever
caused it. On 2026-10-24 the observer thrashing against its own 512 MiB
read `full avg10` 15–20% at the root with 78% of memory available, and
the gate held lanes for an hour (S334). Holding lanes cannot relieve a
stall inside one cgroup's limit. S309's load is the opposite case: lanes
that want more than the VM has, where holding them is the point.

**Question.**

1. Under each load below, what do these read: the root's `memory.pressure`
   (`some`, `full` `avg10`), `MemAvailable`'s share, `/proc/vmstat`'s
   `allocstall_*`, `pgscan_direct`, `pgscan_kswapd` and
   `workingset_refault_file` rises per sample, and each container's own
   `memory.pressure` and `memory.events` `max`?
   - **A:** one container thrashing against its own `memory.max` (a
     working set of code and data larger than its limit, as the observer's
     was) while the VM has room.
   - **B:** the VM short: S309's four lanes of 4 GiB in 12 GiB
     (`docs/findings/S309-lanes-beyond-the-vms-memory/`).
   - **C:** both at once.
2. Is there a reading that is over under B and C and not under A, steady
   across the 5 s samples? Candidates: available memory low and PSI over,
   both (`and`, where the rung reads `or`); global reclaim (`allocstall_*`
   or `pgscan_direct`) rising, which a cgroup's own limit does not count if
   the kernel's accounting is as read from source; the root's stall less
   the stall of cgroups whose `memory.events` `max` rose in the sample.
3. Does `MemAvailable`'s share stay above 10% under B at any point while
   PSI is over, so that `and` would miss a real shortage?
4. Can the reading name the cgroup at its limit, so health can say which
   service or lane stalls (a cause the health value lacks)?

**Kill criterion.** No reading separates A from B and C at every sample:
then the gate cannot tell them apart from what it reads, and the plan
changes what it holds on (a cgroup's own stall is shown and never acted
on), not what it reads.

**Throw away.** The spike VM (`sandbox/machine-spikes/vm.sh`, its own
state directory and capped data disk, never the person's lane VM), its
containers and the load scripts. Kept in this spike's folder of sources if
a plan builds on them: the loads and each run's readings.

## Answers

Run on 2026-10-24 in the spike VM (8 GiB, 8 CPUs, `psi=1`, no swap, huge
pages `always`, as the lane VM is), each load on a fresh boot, read every
5 s from 30 s before it until 30 s after. The numbers below are over the
samples from 60 s into each load to its end (A: 85, B: 50, C: 50), as
min / median / max; every sample is in the folder's `table.tsv`.

- **A:** one container, `--memory 512m`, a Node 24 process holding 440 MiB
  of buffers and reading 128 MiB of files whole, over and over, with
  hashing, deflate and JSON between (`thrash.mjs`). Its `anon` filled the
  limit (534 of 537 MB), `file` about 1 MB. It never finished a pass; it
  was killed by hand after 8 minutes, never by the kernel.
- **B:** S309's four lanes as S309 ran them on this VM (`--memory 4g`,
  1500 MiB anonymous and 1500 MiB of files each: 12 GiB wanted of 8),
  300 s.
- **C:** B's lanes and A's container together. With A's process as it
  ran alone, the container was killed for memory by its own cgroup's OOM
  within about 10 s of the load's start, twice (holding 440, then 420 MiB;
  `C-first/`): under the shortage the cgroup could not reclaim its way to
  its limit. So C's container reads its files through one 1 MiB buffer
  (`chunked`), holding 440 MiB: `anon` 507 MB, `file` 27 MB, as the
  observer's 23 MB, thrashing for the whole 300 s.

| reading (per 5 s sample) | A: one cgroup at its limit | B: the VM short | C: both |
|---|---|---|---|
| root `full avg10` | 17.8 / 20.9 / 26.2 | 9.1 / 9.6 / 10.0 | 9.4 / 9.9 / 10.5 |
| root `some avg10` | 18.8 / 22.1 / 27.6 | 10.1 / 10.7 / 11.5 | 12.6 / 13.4 / 16.0 |
| `MemAvailable` share | 0.895 / 0.895 / 0.896 | 0.098 / 0.195 / 0.203 | 0.035 / 0.131 / 0.153 |
| `allocstall_*` rise | 0 / 0 / 0 | 2.0 k / 3.3 k / 5.9 k | 1.7 k / 2.9 k / 5.3 k |
| `pgscan_direct` rise | 0 / 0 / 0 | 94 k / 147 k / 280 k | 67 k / 122 k / 220 k |
| `pgscan_kswapd` rise | 0 / 0 / 0 | 10.3 M / 12.3 M / 13.1 M | 9.2 M / 10.9 M / 12.1 M |
| `workingset_refault_file` rise | 3.0 M / 3.2 M / 3.4 M | 10.4 M / 12.4 M / 13.3 M | 10.4 M / 12.5 M / 13.6 M |
| the container at its limit: own `full avg10` | 21.7 / 26.1 / 31.9 | (none) | 4.3 / 4.8 / 8.0 |
| its `memory.events` `max` rose | 85 of 85 samples | (none) | 49 of 49 |
| each lane: own `full avg10`; `max` rose | (none) | at most 0.18; in 0 of 50 | at most 0.14; in 0 of 50 |
| root's stall less the at-limit cgroups', % of the sample | 0 / 0 / 3.5 | 8.3 / 10.0 / 11.1 | 2.0 / 5.1 / 9.3 |
| rung 3 as read today (`full` > 10 or share < 5%) | over in 85 of 85 | 0 of 50 | 17 of 50 |
| rung 2 as read today (`full` > 5 or share < 10%) | 85 of 85 | 50 of 50 | 50 of 50 |
| `full` > 5 and share < 15% | 0 of 85 | 11 of 50 | 49 of 50 |
| `full` > 10 and share < 10% | 0 of 85 | 0 of 50 | 2 of 50 |
| global reclaim (`allocstall_*` or `pgscan_direct` rose) | 0 of 85 | 50 of 50 | 50 of 50 |

1. **The readings are the table's.** A reproduces the incident: the root
   read `full avg10` 18–26% with 89.5% of memory available, every sample
   over rung 3, while nothing outside the one cgroup stalled (S334 read
   15–20% at 78%). The VM's file refaults rose 3 million pages a sample
   with no global reclaim at all: `allocstall_*`, `pgscan_direct` and
   `pgscan_kswapd` stayed 0 for the whole run, while `pgscan_file` rose
   about 19 million a sample (median), so that counter counts a cgroup's own
   reclaim and the three do not. Under B the root read `full avg10` 9–10%,
   under rung 3's bound every sample: the lanes' own `memory.pressure`
   read near 0 (at most 0.18%), and the containers' parent cgroup
   (`/sys/fs/cgroup/docker`, read twice during C) 1.0–1.2% while the root
   read 9.9%. Most of the root's stall under a shortage is outside every
   container, in the root cgroup's own tasks: kswapd, which the kernel
   counts as stalled while it reclaims, was running with 105 s of CPU by
   then (read, not traced). A cgroup alone at its limit on a
   machine otherwise idle reads as high at the root as in itself, since
   PSI weighs each CPU by its non-idle time.
2. **Yes: global reclaim.** `allocstall_*` and `pgscan_direct` rose in
   every sample of B and C (each alone too: at least 1,656 stalls and
   66,604 pages a sample) and in no sample of A. They began in the first
   sample in which the lanes' memory met the VM's (15 s into B and C,
   before `full avg10` reached 5%) and stopped within a sample of the
   load's end. `pgscan_kswapd` separates the same way here. The other
   candidates fail: `and` with today's bounds misses B (rung 2's bounds
   with a 15% share: 11 of 50; rung 3's: 0 of 50), and the root's stall
   less the at-limit cgroups' read 2.0% in C against A's 3.5%, so no bound
   separates them.
3. **Yes.** Under B, `MemAvailable`'s share stayed at or above 10% in 49
   of 50 samples (median 19.5%) while `full avg10` was over 5% in all of
   them, and never fell under 5%: `MemAvailable` counts the page cache the
   lanes were thrashing as available. `and` would have missed the shortage
   S309 measured.
4. **Yes.** The cgroup at its limit is the one whose `memory.events`
   `max` rose in the sample (A: 85 of 85, C: 49 of 49), with its own
   `memory.pressure` over (A 22–32%; C 4–8%, since under a shortage the
   whole VM stalls with it); no lane's `max` rose in B or C. The machine's
   sample already reads each container's `memory.events`, `memory.pressure`
   and `memory.max` and the VM's `/proc/vmstat`
   (`packages/lanehost/machine.ts`); the `max` count and the two reclaim
   counters are not yet read.

**The rule the data supports.** A rung's pressure bounds count only in a
sample in which global reclaim rose (`allocstall_*` or `pgscan_direct`,
differenced as the refaults are); the available-share bounds stay as they
are, read with `or`. A sample with the pressure over and no global reclaim
is a cgroup's own stall: shown, naming the cgroups whose `max` rose, and
never acted on. The kill criterion is not met.

**Not measured.** A long-running VM whose page cache fills its memory,
where kswapd and some direct reclaim run in normal use: there a cgroup's
own stall could coincide with global reclaim from a lane's build and read
as the machine's (S309's 27-hour lane VM had reclaimed for hours). A
cgroup at its limit with only cache to drop, whose `max` rises without a
stall: so a cgroup is named by its `max` rising with its own pressure,
never by `max` alone. Only this kernel (6.18.58) and one shape of each
load.

**Kept** in `docs/findings/S335-the-machine-short-or-one-cgroup-at-its-limit/`:
- `sample.sh`: the 5 s reader, run in the VM's root by a privileged
  container (`nsenter -t 1 -m`): a `root` line and a `cg` line per
  container;
- `run.sh`: one load on a fresh spike VM (S308's `vm.sh`), with
  `thrash.mjs` in `Dockerfile.thrash`'s image and S309's `Dockerfile` and
  `lane.sh` (in S309's folder) as `spike-load`. A ran under an earlier
  form that waited for the thrashing process to end, which it never did,
  so it was killed by hand at 8 minutes rather than at T;
- `analyze.mjs`: each sample's rises and candidate readings
  (`table.tsv`) and the summary above;
- `A/`, `B/`, `C/`, `C-first/`: each run's raw samples, table, the
  containers' results (passes, OOM kill), ids and start and end marks.
