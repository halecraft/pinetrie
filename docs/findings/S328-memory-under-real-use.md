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

**Kill criterion.** A rung's bounds are kept only if crossing them predicts
harm in the measurements. A shadow rung (squeeze, freeze, kill) is built
only if it would have fired and freed memory where a pause did not relieve
pressure; else it stays measured and not done.

**Throw away.** The exported measurements, kept in its folder only if a
plan builds on them.
