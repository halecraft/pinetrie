# S290 — `run`'s nested-disk call changes nothing after a data-root step, but the base's scratch lane has no such step, so the plan must make one for every start

- **Status:** Answered
- **Led to:** ADR-0202

**Question.** Docker's `run` (`packages/docker/runtime.ts`) calls lanehost's
`nested-disk` with no lane to clone from before it makes a nested lane's
container, so the nested disk, a bind source, is there. A lane's start also
plans a data-root step (`innerDockerDataRootStep`,
`packages/lanes/plan.ts`), which makes the same call with the lane to clone
from, or none. Is `run`'s call redundant, so the plan can own the step and
`run` can make only the container?

1. Which paths lead to a container's `run`, and does each make the data
   root before it?
2. On a nested disk the data-root step has just made, what does `run`'s
   call change, for each way the step can leave it?
3. Where no step comes first, what does `run`'s call make, and what does
   Docker do without it?

**Kill criterion.** If `run`'s call changes a data root, its owner, its
contents or whether it is a subvolume in any state the step leaves, the
call is not redundant and stays in the runtime.

**Throw away.** The probe's disks under `/var/lib/pinetrie-lanes/s290`,
deleted by the probe. The probe stays in
`docs/findings/S290-the-run-steps-nested-disk/`, since the plan builds on
it.

## Answers

1. **Four paths lead to `run`, and one makes no data root first.**
   `runtime.run` has one caller, `execute` (`packages/lanes/execute.ts`),
   and the `run` step one maker, `planStart`. Its callers:
   - a start on the lane's disk (`decideContainerStart`, kind `disk`):
     `host/work/containers.ts` runs `makeInnerDockerDataRoot` first;
   - a start on a snapshot (kind `snapshot`, `planDisk`): the same;
   - a fork (`planFork`): its data-root step comes after the delete and
     before `planDisk`, in the plan;
   - **the base's scratch lane** (`inScratch`, `packages/lanes/base.ts`,
     through `planDisk`): no data-root step. Its spec is
     `specOf(BASE_LANE, r, true)` (`host/work/setup.ts`), whose grants carry
     the project's `nested`, so in a project granting `lanes.nested` the
     base's container is a nested lane's and binds the nested disk.

   A stopped container's start (`decideContainerStart`, kind `container`,
   plan `start`) makes the data root, then starts the container: no `run`.

   So a thread lane's container made with `lanes.nested` costs two
   `nested-disk` calls, and the base's one. No suite scenario runs a nested
   lane (`apps/pinetrie/e2e/lanes/`; the suites' own lanes are not
   granted `lanes.nested`), so the count is read from source, not from a
   suite's log.
2. **After the data-root step, `run`'s call changes only the nested
   disk's ctime.** Read from source: with no lane to clone from and the
   data root a subvolume, `planInnerDockerDataRootSteps` returns only its
   first two steps, the nested disk's parent and its `ensure` (make it if
   absent, then `chown` it to the rootless user), the same two that every
   data-root step begins with. Measured with the disks role in this
   process (`disksInProcess`) on this lane's btrfs: for each state, the
   data-root step, then `run`'s call, comparing every entry under the
   nested disk (inode, owner, mode, ctime):

| the data-root step | entries | changed by `run`'s call |
|---|---|---|
| kept, no data root before | 2 | the nested disk's ctime |
| kept, a plain `docker/` before | 2 | the nested disk's ctime |
| cloned from another lane's data root | 3 | the nested disk's ctime |
| a source named whose data root has gone | 2 | the nested disk's ctime |

   The ctime is the `chown`'s, to the owner it already had. The kill
   criterion does not hold.
3. **For the base's scratch lane, `run`'s call is the only thing that
   makes the nested disk.** Measured: the nested disk absent, `run`'s call
   made it as a subvolume holding `docker`, the data root. Without it,
   Docker refuses the container: a create through its API with a bind
   whose source does not exist answered `invalid mount config for type
   "bind": bind source path does not exist` (the lane's rootless Docker,
   2026-10-21). So deleting `run`'s call alone would break the base's
   refresh in every project granting `lanes.nested`.

**What follows:** `run`'s call is redundant only where a data-root step
comes first. Taking it out of `run` is correct when every plan that ends in
`run` makes the data root first: `planStart` taking the data root's source,
`keep` for the base's scratch lane, so no plan can make a nested
container without it. The base's step is then the same call it makes today
(`nested-disk`, no lane to clone from), moved from the runtime into its
plan.
