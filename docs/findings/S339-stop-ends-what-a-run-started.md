# S339 — Can a Stop end every process a run started, detached ones included, by the observer's tag of the run?

- **Status:** Open

**Why.** On 2026-10-24 limber-glade's agent ran `( nohup pnpm run
verify:all > log; echo EXIT … ) &` in one `bash` call and polled its log
in later ones (S334). A `bash` call runs in a process group of its own,
and a timeout or an abort kills that group (`packages/pi/lane-shell.ts`);
the call had returned, so its group outlived it, under the container's
init. Each Stop killed the poll in flight; the agent polled again, and the
suite went on to its next step, starting hosts and Chromium, until its
process group was killed by hand.

The observer already knows a run's tasks: a run begins where an untagged
task in a registered lane execs with `PINETRIE_RUN`, and every task it
starts takes its tag, whatever it execs, wherever it moves
(`observe.bpf.c`; `packages/lanehost/TECHNICAL.md`, "The kernel side
decides only which task is in which run"). A `nohup … &` changes none of
that.

**Question.**

1. Does a task started under a `bash` call keep the call's run's tag after
   the call returns: backgrounded (`&`), with `nohup`, with `setsid`,
   double-forked so init adopts it, and in a container the lane's inner
   Docker runs (its `dockerd` is not the run's)?
2. Can the host list a lane's tasks by run (a map the loader reads, as its
   `stats` read the refusals) and signal them, and how long does it take
   with hundreds of tasks (a test suite's)?
3. What is a run here: one `bash` call, or the agent's run of the thread?
   Which should a Stop end: the run's every tagged task, every call's of
   the thread's run so far, or the call in flight alone, as now?
4. Does anything the lane needs outlive a run by design (the lane's
   helper, `hop.ts`, its inner `dockerd`): are they untagged, so a Stop by
   tag cannot touch them?

**Kill criterion.** A task escapes its run's tag by any of 1's ways, or the
host cannot read a run's tasks from the loader: then Stop by tag is not
sound, and the plan ends a run's detached work another way (a cgroup per
run, or the lane's processes but its own).

**Throw away.** The probe's lane and its commands; kept only if a plan's
check builds on them.
