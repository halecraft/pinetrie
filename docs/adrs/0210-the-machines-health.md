# ADR-0210 — pine·trie keeps the machine lanes run on healthy where it owns it, and shows the rest in the footer and on a Machine page

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `docs/06-interface.md`, `packages/vm/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`, `packages/docker/TECHNICAL.md`,
  `packages/machine/TECHNICAL.md`, `packages/lanehost/TECHNICAL.md`,
  `packages/core/TECHNICAL.md`, `packages/lock/TECHNICAL.md`
- **Evidence:** S307, S308, S309, S310, S311, S312, S313, S314, S315, S316,
  S317, S318, S319, S320, S321, S322, S323, S324, S326
- **Revised:**
  - 2026-10-22 (S324): a lanehost role or the observer killed for memory is an
    amber cause, heard from Docker's `oom` events on one held stream, not read
    from its cgroup: the observer's container goes with its kill.
  - 2026-10-22 (S326): a project's lanes are served by one host at a time, so
    the disk upkeep's "a snapshot no record names" reads one store's records.
    The disks role's server holds an exclusive `flock` on the project's
    `host.lock` for its whole life, through a child the kernel frees with it:
    a second host's start is refused, and a dead host's lock is taken by the
    next, with no time judged. A server outlives its host only for its call in
    flight.
  - 2026-10-22: the delete takes core's `Deletable`, not an `Evictable` of
    `@pinetrie/machine`'s: a project's snapshots hold the names of four owners
    (an entry's, a folder state's, the base, no one's), and only
    `deletableSnapshot`, checking the name's owner, makes one. So the upkeep's
    rule deletes only entries, the folder code's only folder states, and
    nothing the base or a name no owner holds. A revision record names a
    snapshot only as core's `IndexedSnapshot`, which the index makes once the
    snapshot under its row, reserved first, is taken: nothing the host makes
    is unindexed, so the upkeep needs no clock to tell an old snapshot from
    one in flight.
  - 2026-10-22: the index's row is a snapshot's lane, the paths its turn
    changed, its place in the order of uses (never a time), whether someone
    branched from it, and its state (`reserved`, `kept`, `to-delete`,
    `deleted`), written before its snapshot; it carries no project, since a
    store serves one folder. An archive marks its snapshots to delete rather
    than deleting them, and a restore keeps its lanes' marked rows again; both
    change the index only on the manager's keeper, where each upkeep step
    plans and deletes, so a restore never lands between the two. The listing
    is split by each name's owner before any rule sees it, and only the entry
    rule deletes.
  - 2026-10-22 (Duane): a folder project's turn snapshots are evicted on the
    same footing as a jj project's, least recently used, though a folder turn
    has no commit to keep its tracked files: a person who chose a folder over
    a repo chose less history. A branch from an evicted folder turn starts
    from its thread's base, and its fork row says so. A store serves one
    folder, so no weighing between a jj and a folder project's turns could
    arise within one index.
  - 2026-10-23: the repair's state is the one every host on the VM shares,
    written only by the repair lock's holder, which every VM's start holds
    too; a failure it records stops every host's repair until the disk could
    grow past its size then, and a host's start does not pass it. It is asked
    for while a host runs only when nothing is left to delete *and* the room
    is spent (`room-unrecoverable` alone holds while gigabytes remain), never
    by a `no space left on device`; at a start, by the console's `data disk
    full` after every boot, Docker answering or not (S322). It is done only
    when it leaves the room no longer spent; the metadata's share is not
    asked, since a disk whose metadata refused every write reads 91% used by
    btrfs's counters, and keeps that share after a repair that gained 37 GiB
    (the `vm-repair` scenario). The repair boot holds the launcher's own lock
    while it has `data.img` open, so no launcher of any version opens it
    beside the repair.
- **Amended by:**
  - ADR-0211: `@pinetrie/lock` gains a macOS backend and a wait, and takes the
    host's own locks too.
  - ADR-0212: of its memory ladder, holding starts and pausing at the gate are
    built now, on every backend; squeezing, freezing into zram and killing are
    planned and recorded but not done, until a record of real use (S328) says
    whether they are needed.

**Context.** On 2026-10-21 a host's start spent 1:08 removing what a dead
host had left in its slot (S307), while the lane VM thrashed: four lanes of
4 GiB on a 12 GiB VM, with 2.5 billion pages refaulted and `khugepaged`
locking CPUs for 22 s at a time (S309). Half an hour later every lane's
write failed with `ENOSPC` while `df` showed 37 GB free: btrfs's metadata
was full, held there by 36,000 subvolumes that nothing bounds (S313, S314),
19,000 of them left by test suites' throwaway projects inside nested lanes
(S321). The person was stopped twice, and learned why only from the
terminal. Nothing in the page said any of it.

A person runs 4 to 20 threads at once. A lane between tool calls holds
almost nothing of its own, only cache; its commands peak at 1.4 to 2.7 GiB
(S316). So lanes fit when admitted by use and pressure, and do not when
admitted by their limits: two would run on a 12 GiB VM.

**Decision.**

- **What pine·trie owns, it keeps healthy itself; what it does not own, it
  shows and leaves alone.** It owns its lanes (their containers, cgroups,
  disks, snapshots) and its store, and on the Mac the lane VM, whose kernel
  and image it ships. On Linux the kernel and the filesystem are the
  person's: pine·trie changes no setting of either, and a setting that
  hurts lanes is shown as a cause.

*Who decides.*

- **`@pinetrie/machine` owns every decision here and does no I/O.** It
  holds the rung's reducer and thresholds, the lanes' treatments
  (`planTreatments`: the treatment each lane should have, from the rung and
  the order of importance), the health value, the disk
  upkeep's plan with `Evictable` and its one maker, the store's size from
  its settings, the repair's states, the snapshot index's schema, and the
  loop that gathers, plans and reconciles through its ports, on a keeper of
  its own. It declares only `@pinetrie/core` and `@pinetrie/keeper` (which
  declares nothing and does no I/O), and never imports `@pinetrie/lanes`,
  `@pinetrie/docker`, `@pinetrie/vm`, `@pinetrie/lanehost` or pi; a
  boundary test holds it to that, as `@pinetrie/lanes`' does.
- **Its ports say what is meant, not how:** `MachineSensor` (pressure,
  each lane's memory and treatment as found, the store's room, its
  filesystem's free space, the host's stalls);
  `LaneControls` (squeeze, hold and release, freeze and thaw, kill: each
  answers what it freed, never a cgroup file's name); `StoreControls`
  (list, delete an `Evictable`, grow, repair); `SnapshotIndex`; and
  `HealthSink`. A backend reports its **capabilities** as a value (pressure,
  freeze, zram, grow, repair), and the planner plans only what is offered:
  on Linux, where nothing grows and nothing is repaired, no plan can ask
  for either.
- **Adapters implement them where the mechanism lives:** lanehost's roles
  for what is read and done in the VM or on the Linux machine: the disks
  role samples, with the cgroup tree bound read-only, and deletes; the
  privileged role acts on lanes' cgroups, with the tree bound read-write
  (S323). A frozen lane is thawed before it is stopped, since Docker does
  not know it is frozen and its stop would wait out its timeout (S323);
  `@pinetrie/vm` for the lane VM's growth and repair; the host for the gate's hold, the index (a table in its
  SQLite file), the record, the keepers and the timer. The host composes
  them, as it composes `LaneRuntime` (`apps/pinetrie/host/work/runtime.ts`).
- **The host depends on one `MachineManager`**: its start, the health value,
  a lane's treatment (for its column's words), the gate's hold, and the disk
  upkeep's triggers. Two implement it: the managing one, and an
  **observe-only** one that reads and reports and does nothing, for a machine
  something else manages (a Linux host whose administrator runs
  systemd-oomd, a node a cluster evicts from). Which one a host runs is a
  setting, `lanes.manage`, in your config or the machine's.
- **The decisions are values, and the code holds the rules:** a running
  lane's container is made with no swap, and only the freeze's own value
  raises it; the delete takes only an `Evictable`, whose maker leaves out
  every protected snapshot; the fork's nearest snapshot is found among
  those still there; the store's size has one maker, held within both settings;
  the gate requires the call's abort signal; the slot's fill requires the
  kill's result; the rungs are one table of `enter` and `leave`, so no rung
  lacks its undo; the causes are a union worded by one function.
- **What remembers is a state machine; the rest is reconciled from what is
  found.** The rung, the health value (each with thresholds to enter and
  leave) and the repair (detected, stopping the VM, booting the repair,
  starting the VM, done or failed; kept in a lock file beside the VM, so a
  host that dies mid-repair leaves it known) remember. Each lane's
  treatment is planned afresh from the rung and the lanes, and the
  reconciler changes only what differs from what the lanes' cgroups and
  gates show, so a host that died with lanes frozen leaves nothing the next
  one does not put right. A lane's treatment is apart from its run's life
  (queued, running, ended), which it reads and never joins.

*Memory.*

- **Lanes run by pressure, on a ladder.** A planner reads the machine's
  pressure (PSI, on in the lane VM with `psi=1`, S308) and available
  memory, and each lane's cgroup, and decides a rung, each with a threshold
  to enter and a lower one to leave, counted in samples:

  | rung | when | what pine·trie does |
  |---|---|---|
  | 0 | calm | nothing |
  | 1, squeeze | some pressure | reclaims idle lanes' cache through their cgroups (`memory.reclaim`, S317) |
  | 2, hold starts | pressure stays | a run that would start, or a lane that would wake, waits in its queue |
  | 3, pause | high | the least important running lanes wait at their gate before their next tool call (S319); the model keeps thinking |
  | 4, freeze | severe | the least important lanes are frozen (`cgroup.freeze`) and their memory reclaimed into zram on purpose (S318) |
  | 5, kill | memory about to run out | one lane's command is killed, chosen by the same order, and the agent is told so as the tool's result |

  It undoes each rung, most important lanes first, as pressure falls.
  **Least important** is a value: a thread someone is reading, then one
  asked most recently, then one whose queue is not held, rank higher.
  A lane's limit stays a ceiling (`LANE_MEMORY`), not a reservation.
- **zram is on in the lane VM, and only frozen lanes swap.** Every lane's
  `memory.swap.max` is 0, lanehost's and the observer's too, and a frozen
  lane's is raised for its reclaim: the kernel can never swap memory a
  running lane uses, which is what made zram cost work in S309 (S318).
  A thaw pages a frozen lane back in, about 2 s for 1.6 GiB.
- **A hold heeds the call's abort.** The gate a held tool call waits at
  settles when the call is aborted, so a Stop is never held (S319).

*Disk.*

- **The store has two settings,** in your config or the machine's, never a
  project's: `lanes.store.max`, the most the store may hold (unset: no
  ceiling of its own), and `lanes.store.leaveFree`, the free space it
  leaves on the filesystem holding it, by default 10% of that filesystem
  or 50 GB, whichever is larger. The store is every lane's disk and
  snapshot, nested lanes' stores, and in the lane VM its Docker's images and
  build cache. Its filesystem is, on the Mac, the volume holding
  `data.img`; on Linux, the one holding the lanes directory; in a nested
  lane, the outer lane's disk.
- **The lane VM grows its own disk** while both allow: at each start the
  launcher grows `data.img` to the size planned from the store's room and
  the volume's free space, never past `lanes.store.max` nor into
  `lanes.store.leaveFree`; space freed in the VM goes back by itself
  (S312). On Linux nothing grows: the settings are kept by eviction alone.
- **The room is btrfs's, read from its counters:** the device's size less
  what each kind has allocated, and metadata's use, from
  `/sys/fs/btrfs/<fsid>/allocation/` (S322), which lanehost's unprivileged
  role can read. Never `df` (S314).
- **One disk upkeep, beside the documents' upkeep.** It gathers what is on
  the disk and what the host's records keep, plans in one pure function
  what to delete and in what order, and deletes on a keeper of its own,
  tracked, one run at a time. It runs at the host's start, after a run's
  end, an archive or a restore, sooner when the room is low, and on a
  timer as a backstop; it never reads a clock to decide. So a crash or a
  stop part way delays a cleanup and never leaks. In its order:
  1. what nothing reaches: a `.tmp` snapshot not being made, a snapshot no
     record names, a lane of a thread that is gone (S321);
  2. a nested lane's inner projects whose root is not on the lane's own
     disk, once its container has stopped: no inner host outlives that
     (S321);
  3. open threads' turn snapshots, least recently used first, until their
     estimated metadata is within `lanes.store.snapshotMetadata` (1 GiB by
     default) and the room is above its floor. Never a lane's newest, a
     snapshot someone branched from, or the base.
- **The host keeps its own index of snapshots** in its SQLite file, beside
  `pinetrie_blobs`: each snapshot's project, lane, root and turn, the paths
  its turn changed (its estimated metadata, about 3 KiB a path, S320), when
  it was last used (a branch, a restore, a diff, a review), and whether it
  was evicted. It is written where a turn's snapshot is made and where a
  snapshot is used, and read by the disk upkeep, so no sweep loads every
  root (S321).
- **A branch from a turn whose snapshot was evicted** clones the nearest
  older one that remains and takes the turn's tracked files from its commit:
  `forkSource` keeps a lost snapshot's recorded point for an open thread,
  where today it starts from the thread's base, as it still does for an
  archived one, whose lanes' refs are gone (S320). A folder project's states are its
  history, and keep their own window (`folder.history.states`).
- **A slot's sweep kills, then fills, then removes** (S307): a dead host's
  containers bound into the slot are killed, which frees their binds; the
  slot is filled; their removals run after, together, off the start's
  path, and a lane's start waits only for its own container's.
- **A lane VM whose disk is full is repaired automatically, offline.**
  When the room is spent and the disk upkeep cannot free enough, or a
  container fails with `no space left on device` (Docker may still
  answer, S322), the host stops the VM and boots
  the repair: the builder's machine on `data.img`, its initrd holding the
  pinned kernel's `btrfs` modules and `btrfs-progs` with its libraries,
  pinned as the builder's pins are, needing no network. It grows the
  filesystem into the space the settings allow, repacks sparse data chunks,
  and reports in `[repair]` lines the host words; then the VM starts again
  and the lanes are made again at their next start. `init` logs why any
  resize of its own failed (S314). On Linux nothing is repaired:
  the filesystem is the person's, and lanehost's privileged role cannot
  write the lanes directory, by design (the `contract` scenario checks
  it). pine·trie evicts, and a filesystem still full is red, its words
  naming the balance the person can run.

*Showing it.*

- **One health value** (`state`, `causes`, `actions`), planned from
  samples by a pure function. `neutral`: lanes and the host keep up.
  `amber`: work waits or slows but goes (a rung from 2 up, the room low, a
  lane OOM-killed, a lanehost role or the observer killed for memory, the
  host's event loop stalling). `red`: work cannot go
  (a lane killed for memory, the room at its floor, a repair running or
  failed, Docker not answering, lanehost's roles down: not answering, which
  a role killed for memory is not, since the next call starts its server
  again). Its type is
  core's, its record rules', and its words one function of
  `@pinetrie/interface`'s, as every label's are. It is written as the session's `pinetrie.machine` record
  when it changes (S315), and automation and the interface both read it.
- **A service's kill is heard, not counted** (S324). A lane's kill is a rise
  in its cgroup's `oom_kill`: its container outlives the kill. The
  observer's server is its container's main process, removed with it, so
  its count goes too. Docker's `oom` event names every container killed,
  by its name and labels, and outlives it; the daemon keeps 256 events, so
  a poll loses one behind about 85 `docker exec`s, and the host holds one
  stream of them, filtered to `oom`, resuming from the last event heard.
- **The footer shows it, on everyone's side, before publish**: a machine
  glyph drawn always, the footer's grey when neutral, amber or red with
  a shape of its own otherwise, never a badge and never moving; its title
  names the worst cause in words. It opens the Machine page. A red cause
  that needs a choice is also in the inbox's **Needs you**; a repair that
  fails is one.
- **A thread's column says why it waits or stopped:** "waits for room in
  the lane VM", "paused for memory", "frozen for memory", "the lane VM is
  being repaired".
- **The Machine page** (`#machine`, a page as Setup is, and in the account
  menu under it): now (each cause, what pine·trie is doing about it, and
  what you can do); threads (each lane by its thread's name: its rung,
  memory against its limit, CPU, disk, what it waits on, its snapshots'
  share of the budget, with **Archive**); the machine (memory, pressure,
  CPU, the store's room against its settings, uptime; the lane VM's size,
  which it holds of the Mac's memory once its guest has touched it, never
  its RSS, S310); the host (stalls, queue waits, `jj` and `git` times,
  lanehost's roles and the observer against their limits); what happened
  lately, a repair's progress among it; and **Copy diagnostics** and **Ask
  an agent about this**. Its samples come by a request it makes while open
  (S315); none is stored. An action says what it costs before it runs.
  **Restart the lane VM** is an action there, never automatic.
- **The start's checklist names the work it waits on** ("removing 10
  containers the last host left, 3 of 10"; "repairing the lane VM's disk:
  growing it to 420 GB, repacking"), never a step's label alone.

**Consequences.**

- Twenty lanes run where twenty did, and when memory runs short the least
  important wait, pause or freeze, said in their columns and the footer,
  instead of every lane thrashing. A lane's command is killed only at the
  last rung, and its agent is told.
- The store stays within its settings for months: what nothing reaches
  goes at the next upkeep, and open threads' old turns are thinned. A
  branch from a thinned turn starts slower: its untracked files are an
  older turn's, and the agent may reinstall or rebuild.
- The image (zram's module, `psi=1`, `init`'s logging), the launcher
  (growing `data.img`) and the builder (the repair) change, so a lane VM
  running when this lands is replaced at its last lease's end
  (`planVmVersion`).
- On Linux the ladder, the upkeep, the indicator and the page work alike;
  there is no VM to grow, repair or restart, and no kernel or filesystem
  setting is changed.
- One more package, `@pinetrie/machine`, with its `TECHNICAL.md`, a
  boundary test and its place in `workspace.test.ts`. Another backend (a
  remote Docker, a cluster's node) is adapters for its five ports; another
  policy is another `MachineManager`.
- What it protects comes to it as facts in the index (a lane's newest
  snapshot, those branched from, those marked), never by importing
  `@pinetrie/threads` or `@pinetrie/rules`.

**Alternatives rejected.**

- **Admitting runs by their lanes' limits**: two lanes on a 12 GiB VM,
  where people run twenty (S316).
- **zram, or a `memory.high` below the limit, for every lane** (S309): both
  did less work than the overcommitted lanes alone. zram is kept for frozen
  lanes only, which S318 shows it serves.
- **Huge pages `madvise`**: it may prevent the long-run `khugepaged`
  lockups, which no spike reproduced; left until one does.
- **Restarting the VM when it is worn and idle**: treats a symptom, and has
  no counterpart on Linux.
- **A balloon to give memory back** (S310), and **a lower priority for the
  VM's process** (S311): neither does anything measurable.
- **A count of snapshots as the budget**: a snapshot costs from 57 KiB to
  megabytes (S320).
- **Reading every root's records to find what is reachable** (S321): it
  loads every root; the host's index answers without.
- **Waiting for Docker to fall silent to detect a full disk** (S322).
- **One line on the thread that waits**: a person working elsewhere never
  sees it.
- **Samples in a document, or in presence** (S315).
- **The management in the host, in `@pinetrie/lanes` or in
  `@pinetrie/docker`**: the host would mix policy with its shell; lanes
  would own the machine beside what a lane is; docker would tie the policy
  to one runtime. None leaves a place to swap the backend or the manager.
