# S235 — A host's startup sweep removes no container a cloned inner Docker carries

- **Status:** Answered (read from source, and its planner run)
- **Led to:** ADR-0169

**Question.** ADR-0169 clones a nested lane's inner Docker data root, and
not the inner lanehost's `projects/` beside it. The clone carries the
source's inner containers (S233). Does the inner host's startup sweep
(`sweepProjects`) remove them, as the ADR expected?

**Kill criterion.** If the sweep leaves them, the expectation is wrong,
and the plan needs a sweep of its own: of containers whose project
lanehost does not list, or of every container at a clone.

**Throw away.** The probe, a call of the sweep's planner.

## Answers

Read from source, 2026-10-18, and the planner run on two inputs.

- **The sweep runs in a nested lane:** a host on another host's Docker
  (`docker-host`, as a nested lane's own host is) calls `sweepProjects`
  when its lanes are ready, as the lane VM's host does
  (`apps/pinetrie/host/work/runtime.ts`).
- **It removes only the containers of a project lanehost lists:**
  `planProjectSweep` (`packages/docker/plan.ts`) takes the projects from
  lanehost's listing of `projects/` in the lanes directory, keeps those
  whose root is gone, and removes the containers labelled
  `pinetrie.project` with one of those keys. A container whose project the
  listing lacks is not removed.
- **A clone of the data root alone lists none of the source's projects:**
  `projects/` is not cloned, so the clone's inner lanehost lists nothing
  but the inner host's own project.
- **Run:** with an empty listing and a container labelled with another
  project, the planner removes nothing; with that project listed and its
  root gone, it removes the container.

The kill criterion fires: the sweep leaves a clone's carried containers,
and their writable layers stay on the clone. The source's networks
(`pinetrie-<key>`) stay too, for the same reason. Not measured: how many
containers a nested lane's inner Docker holds between runs (one held 9 on
2026-10-17); a suite's `cleanUp` removes its lanes, so those left are a
stopped or failed run's.
