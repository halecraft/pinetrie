# ADR-0205 — lanehost owns lanes' disks and their client; a container's start is one plan; a runtime makes containers and images and reaches lanehost's roles

Numbered 0202 until 2026-10-21, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `packages/lanes/TECHNICAL.md`, `packages/lanehost/TECHNICAL.md`,
  `packages/docker/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S301, S288, S302, S303
- **Amends:**
  - ADR-0129: lanehost knows a nested lane's disk, its owner and data root
    given as values when its server starts, and no runtime; one `disk` call
    takes core's `DiskOp`; it exports the disks' client.
  - ADR-0130: the runtime's port is three named parts (disks, containers,
    images); a disk is a directory on the runtime's machine, made by lanehost
    and bound by the runtime.
  - ADR-0169: a nested lane's data root is made by its start's plan, the
    base's scratch lane included, never by the runtime's `run`.
- **Amended by:**
  - ADR-0207: the runtime's containers part names its project's base lane
    (`baseLane`), from the project's key.

**Context.** The coupling survey of 2026-10-19 asked whether lane
infrastructure would hold another directory store for disks, another
container runtime, or lanes that are not Linux.

- **btrfs is behind lanehost's calls already** (S301). They name lanes and
  snapshots, never subvolumes; btrfs is in what carries them out. Three of
  its properties reach past them: a walk's diff trusts that a snapshot keeps
  an unchanged entry's inode and ctime (a copy changed all 20,000 files'),
  a merge's take needs a reflink, and a disk is a directory the runtime
  binds, which no port said.
- **The disks are lanehost's, but their client was Docker's** (S288). Every
  disk call of `dockerRuntime`, and every `FolderDisks` call, was one
  lanehost call; Docker only opened the channel. A test copied the block by
  hand. lanehost's `DiskCall` was, in its own comment, the shape of lanes'
  `DiskOp`. ADR-0169 had put Docker's values for a nested lane in lanehost,
  after ADR-0129 said it knew nothing of Docker. Which role diffs, and
  how, was decided twice from `rootless`.
- **A container's start had a hole** (S303). The data root was a step the
  host ran before a start's plan, and Docker's `run` made the nested disk
  again. For a thread's lane the second call changed only a ctime; for the
  base's scratch lane, which plans no data root, it was the only thing that
  made the nested disk, and Docker refuses a container whose bind source is
  missing.
- **A lane's Linux assumptions** (S302): five are built in (the observer's
  BPF, the lane runtime's ELF, btrfs, OCI containers under Linux's
  isolation, iptables grants), one is a locality (the runtime's machine sees
  the host's files), the rest are values.

**Decision.**

- **A container's start is one plan.** The `run` step carries a
  `PlannedStart`, which only `planStart` makes. `planStart` takes the data
  root's source (`keep` for the base's scratch lane) and returns the steps
  that make the folders the shape binds, then the `run`. Those folders are
  one union (`DiskBind`), and the step that makes each and its path are
  total tables over it. `decideContainerStart` carries every start's
  steps, a stopped container's included. A runtime's `run` makes only the
  container.
- **`DiskOp` is core's,** generic over the lane's name, and lanehost's
  `disk` call takes it: lanehost keeps no copy, and a nested disk and a
  states directory are two of its kinds.
- **`LaneRuntime` is three parts,** `LaneDisks`, `LaneContainers` and
  `LaneImages`, and each caller types the part it uses.
- **lanehost exports the disks' client** (`lanehostDisks`), typed by core,
  so it still declares only core and channel. A runtime gives it the
  channel to a role and the stream of a role's command; Docker's spreads
  it.
- **lanehost names no runtime's value.** A nested disk's owner and its data
  root's directory are required in its server's arguments; docker holds
  them. Which role diffs, and how, is one value `planRoles` decides.
- **btrfs is one module of lanehost's,** of functions, beside a stated
  rule: the walk compares inodes and ctimes because a btrfs snapshot keeps
  them.
- **Nested lanes keep "inner Docker" in their names,** since a nested lane
  runs Docker; only Docker's values left lanehost.

**Consequences.**

- Another container runtime implements `LaneContainers` and `LaneImages`,
  hosts lanehost's roles, and spreads `lanehostDisks`. Another directory
  store is one module beside `btrfs.ts`, with its own walk comparison and
  clone. A store that is not a directory (a volume per lane, cloud volumes)
  moves a disk's mount into the runtime: a different port.
- A lane that is not Linux is not a swap behind these ports: the disk model
  rests on the observer (S302).
- No suite runs a nested lane, so a nested start is held by the plan's unit
  tests.
- `packages/lanes/plan.ts` is split by concern, and lanes' index is written
  by `pnpm run indexes`.

**Alternatives rejected.**

- **Delete `run`'s nested-disk call alone.** It breaks the base's refresh
  in every project granting `lanes.nested` (S303).
- **A `bindSources` call on the disks' port, made by `run`.** It keeps an
  effect inside the runtime where the plan should say it.
- **A snapshot store injected into lanehost's server.** Nothing would swap
  in a fake: the planners are tested pure, and the btrfs side against real
  btrfs.
- **The disks' client in docker, or in the host.** A second runtime would
  copy it, or the host would hold lanehost's calls.
- **Nested-lane names without Docker in them.** No second inner runtime
  exists to name.
