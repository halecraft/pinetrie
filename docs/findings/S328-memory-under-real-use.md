# S328 — How often real use reaches each memory rung, and whether holding lanes there relieves it

- **Status:** Open

**Question.** ADR-0212 builds two rungs of ADR-0210's memory ladder
(holding starts at 2, pausing at the gate at 3) and keeps measurements of
the machine (`pinetrie_machine_samples`, `pinetrie_machine_lane_samples`,
`pinetrie_machine_shell_calls`, `pinetrie_machine_decisions`), exported by
`GET /machine/measurements`. From those measurements of real use on the Mac
and on a Linux host, over at least a week each:

- how often each rung's bounds (`RUNG_BOUNDS`) are crossed, for how many
  samples, at how many lanes, and with which programs in flight;
- whether pauses and held starts relieved pressure in the samples that
  followed them;
- whether refaults and `bash` calls' durations rose where the rung did:
  whether the bounds mark harm;
- how the count of lanes allowed to call moved under rung 3;
- what the shadow squeezes, freezes and kills would have freed, how often,
  and against which lanes;
- each program's peak `anon`;
- how the available-memory bounds of rungs 2 and 3 track PSI on samples
  that have both, and how a host in a lane's own-cgroup available (S329)
  tracks its pressure.

**Before it runs.** The export's first line names the numbers the
samples were planned by (`numbers`), read from the code's constants as
they are: `RUNG_BOUNDS`, `ENTER_AFTER` and `LEAVE_AFTER`, the overdue
bound and the sample's interval, the room's and metadata's thresholds and
clears, `minimumUnallocated`'s share and floor, and the memory limits the
services' and lanes' containers are made with. So each sample is read
against the numbers that planned it, and a week's export from before a
change is not read as one from after it. Beside the samples, the export
keeps the machine's own reclaim's rise per sample
(`pinetrie_machine_reclaim`: `allocstall_*` summed, `pgscan_direct`,
`pgscan_kswapd`; none on a host in a lane) and, as a `cgroup-at-limit`
event, every lane, service or host in a lane's own cgroup whose
`memory.events` `max` or `high` rose since the last sample.

**What its answers decide, beyond the bounds.** Whether S335's rule (a
rung's pressure bounds count only in a sample in which the machine's own
reclaim rose) holds on a long-running machine whose page cache fills its
memory, where reclaim is routine: whether a cgroup's own stall coincides
with reclaim from a lane's build there. Each sample keeps what its
pressure was read as (`pinetrie_machine_scopes`: the machine's, contained,
or unmeasured), so the week shows how often a stall was contained and
whether the rung would have moved without the rule. Each kind's process
count, CPU share and OOM priority (`CONTAINER_LIMITS`, named in the
export's heading with the services' floor) are tuned from the week: a
lane's 16,384 processes holds a nested lane's whole tree, its inner
Docker and lanes among it, which `verify:all` with Chromium ran under a
few thousand threads. The services' memory budgets: how
often, and when, the observer, which fills by connections (S325), and
lanehost's roles meet their limits, and each lane meets its own. How those
numbers are changed from then on: an edit of the constants, one set of
numbers per backend, or a person's setting in `pinetrie.json` where the
measurements show one machine needs another number. The seam is shaped then, from what
the answers ask for; none is built ahead of them. `ROOM_SPENT` and
`METADATA_FULL` are written into the lane VM image's `init` too, so any
change to them changes the image with them.

**Kill criterion.** A rung's bounds are kept only if crossing them predicts
harm in the measurements. A shadow rung (squeeze, freeze, kill) is built
only if it would have fired and freed memory where a pause did not relieve
pressure; else it stays measured and not done.

**Throw away.** The exported measurements, kept in its folder only if a
plan builds on them.
