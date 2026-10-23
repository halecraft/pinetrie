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
| `ports.ts` | `MachineSensor`, `HealthSink`, `MachineManager`, `HostLaneFacts`, `MachineMeasurements` |
| `sample.ts` | `MachineSample`: what one sample measured and heard, and only that; `SensedSample`, the sensor's part of it |
| `snapshot-index.ts` | the host's index of a project's entry snapshots as rows (`SnapshotRow`, `RowState`) and three ports: `SnapshotReads`, `SnapshotTaking`, `SnapshotIndex` |
| `store-settings.ts` | `StoreSettings`, `LeaveFree`, `LEAVE_FREE_DEFAULT`, `leaveFreeBytes`, `minimumUnallocated` |
| `health.ts` | `planHealth` and its state (`HealthPlanState`): the causes, their thresholds, the state; memory short as `MemoryShort` adds it |
| `hysteresis.ts` | a level's and an event's count from sample to sample (`nextLevelState`, `nextEventState`, `ENTER_AFTER`, `LEAVE_AFTER`), shared by the causes and the rungs |
| `rung.ts` | memory's rung (`Rung`), its bounds (`RUNG_BOUNDS`) and `planRung` |
| `importance.ts` | which lanes matter most (`rankLanes`) |
| `treatments.ts` | each lane's treatment (`planTreatments`, `Treatments`), what each allows (`ACTIVITIES_ALLOWED`), the shadow decisions of the rungs not built |
| `measurements.ts` | the measurements' rows (`SampleMeasured`, `LaneMeasured`, `DecisionMeasured`) and a command's program (`commandProgram`) |
| `manager.ts` | `createMachineManager`: gather, plan, write, and the disk upkeep's steps, on a keeper of its own; `MANAGE_MODES` |
| `store.ts` | what the upkeep reads and does: `StoreListed`, `StoreControls`, `StoreRecords` |
| `retention.ts` | the table of owners' rules (`RETENTION`), the listing split by owner (`partitionByOwner`), the entry rule (`planEntryRetention`) and what it never takes (`isProtected`, `newestByLane`) |
| `upkeep.ts` | the next bounded step (`planUpkeepStep`): the index's fill, or deletions of entries, lanes no thread will run (`deletableLanes`) and stopped nested lanes' abandoned inner projects (`abandonedInnerProjects`) |
| `fixtures.ts` | test support: the index in memory, a store and records to plan over |
| `capabilities.ts` | what a backend can do to the store (`Capabilities`, `planCapabilities`): the lane VM grows; Linux does not |
| `store-size.ts` | how large the store's disk should be (`planStoreSize`, the one maker of `StoreSize`) |

## Rules

- **Of memory's ladder, rungs 2 and 3 act; 1, 4 and 5 are measured**
  (ADR-0212). The rung (`planRung`) is the highest of five levels, each
  with the causes' hysteresis (`hysteresis.ts`), moved one step a sample,
  so a release lets go one rung's holds at a time. Each rung's bounds are
  one table (`RUNG_BOUNDS`): PSI's `avg10`s, and the share of memory
  available. A rung entered by either kind of bound is cleared only when
  every bound it reads is clear; without PSI the available bounds alone
  read, so rungs 2 and 3 hold on such a kernel, and rung 1, whose bounds
  are all PSI, is unmeasured. The PSI numbers are S309's and the available
  shares are set to enter before 4 and 5's; S328 tunes them.
- **A hold is a treatment, planned afresh each sample** (`planTreatments`):
  nothing is released by hand, so no release can be forgotten. Every lane
  has one, a started one or not (`laneTreatment`): one not running is
  `waiting-to-start` from rung 2, or while held starts are being let go,
  else `normal`. Running is every running lane container, its cgroup read
  or not (`lanesRunning`), so a backend that reads no lane's cgroup does
  not hold its running lanes for being unseen. `ACTIVITIES_ALLOWED` says,
  in one place, what each treatment lets a lane do; a treatment added to
  core's `LaneTreatment` fails `tsc` until it says (`types.test.ts`).
- **Held starts are let go one a sample**, most important first
  (`rankLanes`: a thread someone reads, the latest run started, a queue not
  held, then by id), so a release never starts every held command at
  once. A lane let go is `normal` until a sample lists it running.
- **At rung 3 only the most important running lanes make tool calls**:
  their count (`lanesAllowedToCall`) starts at every running lane, falls by
  one each sample the rung holds, never below 1, and rises by one each
  sample below it. A pause stops the next heavy command and frees nothing
  in flight (S316), so no estimate of what it frees enters the choice;
  whether pauses relieve pressure is S328's to read.
- **Rungs 1, 4 and 5 are shadow decisions**: a squeeze of each idle
  lane's page cache from rung 1, a freeze of each paused lane's `anon`
  from rung 4, a kill of the least important lane with a call in flight at
  5, each naming only a lane whose memory was read. `LaneTreatment` has no
  kind for them, so nothing can be asked to do one.
- **`waitUntilAllowed` is what waits** (the host's gate and its start): it
  settles when the last plan's treatment allows the activity, rejects on
  its signal's abort, settles at once observing and before the first
  plan, and is refused (`KeeperClosed`) at `close`, so a stopping host
  waits on none. A start waiting is what the next plan counts among the
  lanes waiting to start.
- **Observing, the rung is planned and measured, and nothing is held**: the
  treatments are planned for their shadow decisions only, every lane is
  `normal`, and memory short is said without a hold (`isHolding`).
- **The measurements are kept in both modes** (`MachineMeasurements`): each
  sample's rung, pressure, memory, its source and the kernel's counters'
  rise since the last (`counterRise`, none across a reset); each running
  lane's memory in MiB and its program, kept only when it changed
  (`lanesChanged`); every treatment changed and every shadow decision, with
  the pressure and memory at that moment. An action's effect is never
  stored: S328 joins the samples that follow. They are trimmed on the
  sample's own step every `TRIM_MEASUREMENTS_EVERY_SAMPLES`, not by the
  upkeep, which runs only in `manage` mode. The manager reads no clock: the
  host's store stamps each row. A write that fails is told (`unmeasured`)
  and the sample goes on.

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
  says. A **level** cause (the store's room, the filesystem) enters after `ENTER_AFTER` samples in a row over its threshold
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
- **No rule subtracts a kept set from the listing.** The listing is split
  by `snapshotOwner` before any rule sees it (`partitionByOwner`), and each
  owner's rule decides its own names (`RETENTION`, exhaustive): only the
  entry rule deletes; folder states are the folder code's (`planKeep`),
  and the base and names of no owner are nobody's. So a name nothing
  decided about stays, and a rule written for one owner cannot reach
  another's. Every entry deleted is made by `deletableSnapshot("entry")`.
- **The entry rule, in its order** (`planEntryRetention`): rows marked to
  delete, and rows deleted whose name is still listed (a deletion cut
  short); then names with no row, but only once the index is complete
  (a row is written before every snapshot and the project's lock keeps
  other hosts out, so no row means no one will name it); then the least
  recently used kept rows, never one branched from nor a lane's newest
  (by id, a UUIDv7's order of making), until the kept rows' estimated
  metadata (`snapshotCost`, S320) is within `lanes.store.snapshotMetadata`
  and the room, with what each frees, is above its floor.
- **A folder project's turns are evicted on the same footing as a jj
  project's** (ADR-0210): least recently used, though an evicted folder
  turn's files are gone, since it has no commit to keep them. A store
  serves one folder, so one index never weighs the two kinds against each
  other.
- **The upkeep is bounded steps** (`planUpkeepStep`): at most
  `DELETIONS_PER_STEP` deletions and removals, or one batch of
  `INDEX_ROOTS_PER_STEP` roots of the index's fill, and whether more
  remain, which queues the next. Samples interleave, and each step is
  planned against the latest facts. While the index is incomplete the
  step only fills it, from every root's revision records, and deletes
  nothing; a kept row whose snapshot is no longer listed is marked
  deleted with nothing deleted. A lane's disk goes when its thread will
  never run again (no record, or in an archived canvas), never while it
  runs, and only under a thread's name; a stopped nested lane's inner
  projects go when their recorded root is not on the lane's disk
  (`WORKSPACE_ROOT`), as `planProjectSweep` drops a project whose root is
  gone.
- **A dead host's reservations are settled before the first plan**
  (`settleReserved`, from the first step's listing): the project's lock
  and the store's keep any other host out, so each is a dead host's.
- **Only the manager's keeper changes the index's states** but for a
  snapshot's own life: an archive's marks (`markArchivedForDeletion`) and a
  restore's (`keepRestored`) are `run` steps there, and a step plans,
  marks and deletes inside itself, with nothing awaited between its plan
  and its marks. So a restore comes before a step plans or after it ends,
  never between. A row is marked deleted before its snapshot is, so no
  fork picks one about to go.
- **Managing or observing** (`ManageMode`, the host's `lanes.manage`): an
  observing manager samples and reports, and runs no upkeep; an archive's
  rows are still marked, for a host that manages later.
- **The upkeep is heard in the health value**: `freeing-room` (amber)
  while its last step deleted snapshots with the room under its floor,
  `room-unrecoverable` (red) while its last found nothing left to delete
  and the room still under it, each a level read from the sample's
  `upkeep`, which the manager fills, not the sensor.
- **The store's disk grows only where the backend can** (`Capabilities`,
  the first action to need one): `planStoreSize` grows a disk whose
  unallocated room is under its floor by the larger of a quarter and
  64 GiB, to at most `lanes.store.max` and at most what the volume gives
  while keeping `lanes.store.leaveFree`, and never shrinks one. The lane
  VM's lease grows it at its next start (`packages/vm/TECHNICAL.md`), and
  `room-low` says so (`grows`), planned from the sample's room and
  filesystem.
- **A change is a change of meaning.** `planHealth`'s `changed` is true
  when the state, the set of causes by kind and lane, memory's rung, or the
  lanes held and how, differs from the value last written; a cause's
  measures changing alone is not. So the
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

`health.test.ts`, `hysteresis.test.ts`, `rung.test.ts`,
`treatments.test.ts` and `importance.test.ts` (properties over random
lanes, rungs and rankings), `measurements.test.ts` (a property:
`commandProgram` never returns an argument), `types.test.ts`,
`manager.test.ts`, `store-settings.test.ts`, `boundary.test.ts`,
`retention.test.ts` (a property, over random listings of every owner's
names and random rows: no plan deletes another owner's name, a protected
row, an unindexed name before the index is complete, or more than its
limit, whatever the clock), `upkeep.test.ts`; the index's
own, in the host (`apps/pinetrie/host/snapshot-index.test.ts`); mutations in
`scripts/mutations/machine.ts`.
