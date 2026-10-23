# `@pinetrie/machine`: technical notes

Every decision about the machine lanes run on, and none of its I/O
(ADR-0210): what a sample means, the health value and its thresholds, the
store's settings as values, and the loop that samples, plans and writes.
What it does not own: reading the machine (lanehost's disks role, Docker,
the host's `statfs`), the record's schema (`@pinetrie/rules`' `MACHINE`),
and every word (`@pinetrie/interface`' `machineWords`). The health value's
types are core's (`packages/core/machine.ts`), so the package, the record
and the words share one.

| module | holds |
|---|---|
| `ports.ts` | `MachineSensor`, `HealthSink`, `MachineManager` |
| `sample.ts` | `MachineSample`: what one sample measured and heard, and only that; `SensedSample`, the sensor's part of it |
| `snapshot-index.ts` | the host's index of a project's entry snapshots as rows (`SnapshotRow`, `RowState`) and three ports: `SnapshotReads`, `SnapshotTaking`, `SnapshotIndex` |
| `store-settings.ts` | `StoreSettings`, `LeaveFree`, `LEAVE_FREE_DEFAULT`, `leaveFreeBytes`, `minimumUnallocated` |
| `health.ts` | `planHealth` and its memory: the causes, their thresholds, the state |
| `manager.ts` | `createMachineManager`: gather, plan, write, on a keeper of its own |

## Rules

- **No I/O lives here.** It declares only `@pinetrie/core` and
  `@pinetrie/keeper` (`workspace.test.ts`), and `boundary.test.ts` refuses
  any import of a lane package, a runtime, pi, or Node's `fs`,
  `child_process` and `net`. The manager sequences effects through its
  ports and performs none; its tests hand it fake ports and samples.
- **Dependencies point inward.** `@pinetrie/docker`, `@pinetrie/lanehost`
  and `@pinetrie/vm` never import this package: they expose raw calls
  (lanehost's `machine-sample`, Docker's `runningLanes`), and the host
  (`apps/pinetrie/host/machine/`) maps their answers into the ports' types
  and composes the manager. So the adapters serve any manager, and the
  manager runs over any backend.
- **The seams.** The ports say what is meant, never a file's name. The
  sample says what a backend could not read by a null or an empty list,
  and the planner plans only from what was measured: a backend without
  lanes' cgroups gives no lanes, and so no lane cause. The
  `pinetrie.machine` record is the one thing readers depend on. A new
  backend is adapters for the ports; a new policy is another
  `MachineManager`; a new signal is a sample field, a cause in core's
  `MachineCause` and a threshold, which `machineWords`' `assertNever`
  holds until worded; a new reader reads the record. A new action is a
  port method and the planner's output, with a capability (ADR-0210) only
  when what a backend can do is no longer read from what it measured: the
  first action brings it, as nothing reads one before.
- **Thresholds count samples, never time.** The lane VM runs after the
  Mac's own work, so a sample can come late; a count still means what it
  says. A **level** cause (the store's room, the filesystem, memory
  stalls) enters after `ENTER_AFTER` samples in a row over its threshold
  and leaves after `LEAVE_AFTER` in a row clear of a lower one, so a value
  crossing one threshold back and forth never flaps. An **event** cause (a
  lane's OOM kill, a service's, a host stall) is never seen twice running:
  it enters on the sample it is seen in and leaves after `LEAVE_AFTER`
  without it. A level not measured in a sample keeps its count.
- **A lane's kill is counted; a service's is heard.** A lane's is a rise in
  its cgroup's `oom_kill` between two samples: its container outlives the
  kill. A service's (a lanehost role's, the observer's) is in the sample's
  `serviceKills`, each kill heard from Docker's events since the last
  sample, since the observer's container is removed with its kill and its
  count with it (S324, ADR-0210). Each service is its own cause.
- **A skipped snapshot is heard by the manager, not the sensor.** The
  host's lane work tells `noteSnapshotSkipped` when a turn's snapshot was
  skipped for its index row (`apps/pinetrie/host/work/snapshot-taking.ts`);
  the manager counts them into the next sample's `snapshotsSkipped` and
  starts again from none, and the sensor's `SensedSample` has no such
  field. The cause, `snapshot-skipped`, is an event.
- **The snapshot index is written before its snapshot** (ADR-0210). A row
  is `reserved` before its snapshot is taken, `kept` once taken, `deleted`
  when never taken, and `to-delete` once a rule said it can go; no upkeep
  touches a `reserved` row, and at a start every one left is a dead
  host's. So nothing the host makes is ever unindexed, and a name with no
  row is an older store's. `used` is a place in the order of uses (the
  highest so far plus one), never a clock; `branched` once a branch took
  the snapshot, never unset. Only `markTaken` makes core's
  `IndexedSnapshot`, which is all a revision record is written with, so a
  `Reservation` is not one and no record names a snapshot whose taking
  failed.
- **Each writer of the index is given the narrowest port it needs.** The
  host's lane work (turns, merges, forks, containers) takes
  `SnapshotTaking`; the manager alone is given the whole `SnapshotIndex`,
  so only its keeper moves a row to delete, keeps one again, or settles
  what a dead host reserved. The host composes them once.
- **A change is a change of meaning.** `planHealth`'s `changed` is true
  when the state, or the set of causes by kind and lane, differs from the
  value last written; a cause's measures changing alone is not. So the
  record is written a few times an hour, not every sample, and its
  measures are those of the sample that changed it.
- **A failed sample changes no count.** Its causes stay as they were, with
  `unsampled` beside them, until a sample reads.
- **Two thresholds of space, not to be confused.** `leaveFreeBytes` is
  the free space pine·trie leaves on the person's filesystem holding the
  store: by default `LEAVE_FREE_DEFAULT`, the larger of 10% of it and
  50 GiB, and `lanes.store.leaveFree` replaces it. `minimumUnallocated` is
  inside the store: the space btrfs has not yet given to any data or
  metadata chunk, 10% of the store and 8 GiB at least, below which the
  store is low however much free space its chunks still hold. A
  percentage and a byte count compare only once the filesystem's size is
  known, so the setting holds every amount (`LeaveFree`) and
  `leaveFreeBytes` takes the largest.
- **The record is written at start and at close.** `start` writes
  `unsampled` ("waiting") before the first sample, and `close`, after any
  sample that runs, writes it again ("stopped"), so a stopped host's red
  never outlives it. A write the sink refuses is tried again at the next
  sample.
- **A keeper of its own.** The host's timer asks for a sample with the
  manager's `later("sample")`, which merges asks made while one is queued:
  samples never overlap, and never wait behind or hold up the documents'
  keeper, on which only the sink's write runs. The keeper's own rules are
  `packages/keeper/TECHNICAL.md`'s; its `onSlow` reports a sample that
  drags.

## Tests

`health.test.ts`, `manager.test.ts`, `store-settings.test.ts`, `boundary.test.ts`; the index's
own, in the host (`apps/pinetrie/host/snapshot-index.test.ts`); mutations in
`scripts/mutations/machine.ts`.
