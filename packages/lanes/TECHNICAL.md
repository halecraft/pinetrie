# `@pinetrie/lanes`: technical notes

This package's one job is what a lane is and what runs in it: the
container's shape, mounts, grants, lane config, disks, forks, snapshots, the
base, the queue and the handle (ADR-0032 to ADR-0034). It defines two kinds
of port and implements neither: the `LaneRuntime` (ADR-0130), which
`@pinetrie/docker` implements and the app composes
(`apps/pinetrie/host/work/runtime.ts`); and what a kind of project gives
lanes (ADR-0142), a lane's history (`LaneHistory`, The ports), which
`@pinetrie/jj` implements. Every lane has its own copy: none works directly
in a directory (ADR-0102).

**This package runs no jj** (`boundary.test.ts`): a lane's history, your
repo and every jj name are `@pinetrie/jj`'s (`packages/jj/TECHNICAL.md`),
which builds on this package. The one exception is the image check's `jj
--version`, which asks the host's jj its version and runs jj on no repo.
This package never imports `@pinetrie/jj`. It declares only
`@pinetrie/core` (`workspace.test.ts`), and the client may not depend on
it. It never imports pi (ADR-0003): the channel into a lane is
`packages/pi`'s, and the host hands it in as an `OpenLink`.

The evidence is in `docs/findings/`: S39 to S44 for containers, disks and
the helper, S122 to S131 for Docker and the lane VM.

## The runtime port (`runtime-port.ts`)

- **A lane's container is decided once, as a value** (`planShape`): a
  `ContainerShape` holds its name, its lane (its disk, at `/workspace`), the
  image, memory, mounts (`planMounts`), environment, what is attached
  (`hostSocket`, `starts`) and `nested`, and no
  runtime's flags. A runtime renders it (`runSpec`); the hash of that value
  is its spec label (`specHashOf`).
- **Planners return values; a runtime turns them into commands.** A plan is a
  list of `Step`s: a `LaneStep` (a command in the lane, through its channel)
  or a `RuntimeOp` (a `DiskOp`, or a container made from a shape), carried
  out by `execute` through `Runners.runtime`. A list of lane steps alone
  needs no runtime, so `@pinetrie/jj` never has one.
- **What any runtime must do:**
  - a snapshot that holds what the lane wrote, after the `sync` before it
    (`planSnapshot`), and a restore from it into a new disk;
  - what differs between two snapshots (`diff`), deletions included;
  - a disposable container on the lane's disk, made from its shape;
  - `exec -i` that carries stdin's end to the helper (`execArgv`);
  - the base kept as a snapshot like any other (`BASE_SNAPSHOT`), per
    project;
  - images built from a Containerfile, and a throwaway container's stdout as
    bytes (`runInImage`), from which the lane runtime is extracted.
- **Who implements it:** `@pinetrie/docker` (`dockerRuntime`, the Mac's lane
  VM and Linux), the one implementation.
- **A folder project's merges are a port of their own,** `FolderDisks`
  (`folder-disks-port.ts`), beside `LaneRuntime`: what a snapshot holds at
  paths, alike content, a merge's steps applied to a disk, any file of a
  snapshot read, and a lane's states directory. `@pinetrie/docker` builds
  one on the same lanehost (`DockerRuntime.folder`), and only the folder
  adapter is given it, so `LaneRuntime` and every fake runtime carry none
  of it.

## The ports (`history-port.ts`, ADR-0142, ADR-0150)

- **A lane's history has one kind, on its record** (`LaneRecord.history`,
  `@pinetrie/core`): its disk holds a jj repo or it does not, from the
  moment it is made. A new lane takes the kind of the disk it clones
  (`sourceHistory`, `@pinetrie/rules`): a lane's snapshot gives that
  lane's, the base snapshot the project's. The host hands an adapter a
  lane's record, and the adapter proves it of its own kind before it reads
  any of the lane's states, or refuses it as a whole (`ForeignLane`). The
  proof and the refusal are tagged answers, switched on `kind`, never
  told apart by a missing field.
- **The ports name states by `PointId`** (`@pinetrie/core`): opaque
  strings, a jj commit's id or a folder's snapshot's, read by the kind of
  the lane they are read in. Nothing in this package converts one; it
  passes them through. Where an adapter reads in its own terms, the shape
  is generic once (`TurnCommittedOf<P>`, `MergedOf<P>`, core's
  `LaneBaseOf<P>`), the port's the `PointId` form.
- **A lane's history is reached only on its queue.** `LaneHistory` is what
  a lane's copy records and merges: a turn (`commit`, `recordTurn`), its
  base (`base`), a catch-up (`readyToMerge`, `merge`), its conflicts, what
  it records once its fork made its disk (`begun`: a folder lane's start
  state; nothing for jj, whose fork setup's commit records its base), and
  what a disk restored from a snapshot needs at each container's start
  (`afterRestore`). The host hands it out only
  through its registry's `withHistory`, which queues the caller's function
  on the lane's queue (The queue): no module holds one outside a queued
  step, so every change to a lane's history runs there by construction. A
  step already on the queue is handed the history, never asks for one.
- **A merge takes a copy found ready** (`ReadyCopy`, `@pinetrie/core`):
  `planCopyReady` is its one maker, so no caller merges a copy nobody
  checked.
- **A fork and the base are planned with the adapter's steps.** `planFork`
  takes a `ForkSetup` and `refreshBase` a `BaseCheckout`, each a branded
  wrapper of `LaneStep`s that only its own maker wraps
  (`history-port.test.ts` holds that neither takes the other). A
  `ForkSetup` also names the snapshot the fork restores (`from`): null for
  the fork source's own, as jj's; a folder lane's from your folder names
  your folder's newest state. A kind whose forks name their own has no
  base snapshot: its `AcceptedNow.checkout` is null, and `refreshBase`
  then does nothing.
- **What follows a move is the adapter's, fired by the caller**
  (`Follow`): `recordTurn` and `merge` hand it back, and the caller fires it
  after the snapshot step it queues next, so its work (for jj, the fetch
  into your repo) never delays the snapshot or the next tool call. Firing
  it is a caller's obligation, held by a unit test at each call site.
- **A site is where the destination reads a file** (`ReadSite`, `FileAt`):
  accepted work, a lane's newest state, or its start.
- **The port suite** (`testing/history-suite.ts`, exported as
  `@pinetrie/lanes/testing`) checks the history algebra's laws, beside
  examples of what any adapter's history must do; `test` and `expect` are
  passed in, so this package depends on no test runner. Each adapter runs
  it against a rig of its own.

## The history algebra (`history-port.ts`, `testing/history-suite.ts`)

The lane side of the port is one small algebra, whatever kind keeps the
history:

- **States** are points of one lane's history, and of the project's,
  which shares their ids (`PointId`), compared by equality alone
  (`packages/core/TECHNICAL.md`).
- **Its operations are the port's:** a turn recorded as a state, with the
  paths it changed (`recordTurn`); the lane's base (`base`); a state merged
  into the lane, clean, conflicted or nothing (`merge`); the conflicts in
  the copy (`conflicts`).
- **Ancestry, merge bases and diffs are each adapter's own**, computed
  inside it, never a port method: no crossing between an adapter and the
  shared history needs more than an equality test. What a kind does on the
  destination's side (offers, WIPs, stacks) is not part of the algebra.

jj computes its merge bases inside one command and reports none through
the port; a folder project's graph states its own laws in
`packages/folder/TECHNICAL.md`, "The graph's laws".

Its laws, each one test in the port suite titled by the law's sentence
(`scripts/laws.test.ts` holds each law to exactly one):

- **A merge of what the lane holds merges nothing.** Merging a state
  the lane already holds (its own start, or a state it merged before)
  answers `nothing`, and changes no file.
- **A turn's paths are its diff.** A recorded turn's `paths` equal the
  paths that differ between the lane's newest state before it (`newest`)
  and the turn's state (`committed`), including a turn the agent committed
  itself in several commits.
- **A clean merge descends from both sides.** A clean merge's result
  has the lane's state before it (`ours`) and the state merged (`from`) as
  ancestors.
- **An accept then a catch-up changes no file.** Once the lane's offer
  is accepted, its catch-up with accepted work changes no file in the
  lane: made at once, and made after the lane edits the accepted lines
  again and records a turn, with no catch-up between and accepted work
  unchanged since. It answers `nothing`, or `clean` with no files, and the
  lane's files read as before. The second order is the one that needs
  jj's joins (ADR-0079).

The rig's hooks (`HistoryRig`'s `isAncestor`, `changedPaths` and
`accept`, `RigLane`'s `commitAsAgent`) are test-only: a law that needs
ancestry or a diff reads it through them, so the port never gains either.
A harness reads its diff independently of the adapter's own, or "A turn's
paths are its diff." would compare a function with itself.

## Where things are

- `plan.ts`: every decision, pure. It covers the container's arguments,
  grants, link mounts, fork, turn, bundle and base steps, the images and
  their tags (`planImages`), and what the host finds at startup.
- `execute.ts`: runs a list of `LaneStep`s in order, on the host or in the
  lane.
- `run.ts`: commands as `Runner`s, on the host or in a lane.
- `history-port.ts`: the ports a kind of project implements (The ports).
- `host.ts`: what the host reads of its own machine at startup: the links
  under your working copy's `node_modules` (`gatherLinks`). Config files are
  `@pinetrie/config`'s. Your repo's startup reads
  and writes are `@pinetrie/jj`'s (`startup.ts`).
- `planProjectDir` (`plan.ts`) decides a project's root and its kind from
  `RootFacts`: a jj workspace is `jj`, any other folder (a git repo
  included) `folder`; or it refuses the folder (`ProjectDirRefusal`, worded
  by `projectDirWords`). The kind is that one fact, read once, where the
  host chooses the project's adapter (`apps/pinetrie/host/project.ts`).
  `folderRefusal` words why a folder has no lanes yet. `planShared` and `sharedCandidates` decide the shared
  directories, which `@pinetrie/jj`'s `prepareShared` carries out.
  `sessionFiles` is the layout of a session's data directory
  (`$XDG_DATA_HOME/pinetrie/sessions/<name>/`, ADR-0149, ADR-0150): the
  store, and the lanes' `runtime`, `lane-git`, `lane-ssh` and ssh secret.
  The host computes it once and hands each part in; nothing of pine·trie's
  is written in the project, for any kind (ADR-0142).
- `image.ts`, `runtime.ts`: the image and the lane runtime. `image.ts`
  gathers what `planImages` needs and builds what it plans.
- `runtime-port.ts`: `LaneRuntime`, every call the host makes to a
  runtime, and `DiskOp`. This package implements no runtime: Docker's is
  `@pinetrie/docker`'s (`dockerRuntime`).
  `lane.ts`: the container, the queue, and the handle. `base.ts`: the
  base snapshot (`refreshBase`).

## Disks and snapshots

- **Every disk operation is a `DiskOp`** (`runtime-port.ts`), carried out by
  the runtime the host hands in: create, restore from a snapshot, snapshot,
  delete, and delete snapshots. Docker's keeps both as btrfs subvolumes,
  and carries each operation out as a call to lanehost's `disks` role over a
  held channel (ADR-0129, `packages/lanehost/TECHNICAL.md`).
- **A snapshot is read-only:** a restore is a writable snapshot of it, and
  `diff` compares two (`packages/lanehost/TECHNICAL.md`, Diffs).
- **`sync` comes before every snapshot** (`planSnapshot`). Otherwise files the
  lane wrote but had not flushed come out empty in the snapshot (S41 item 1).
- **The base is a snapshot like any other** (`BASE_SNAPSHOT`), which each
  runtime keeps per project. What it holds is written inside it
  (`.pinetrie-lane/base.json`, `BaseFacts`) and read back through the
  runtime (`readLaneFile`), so the two cannot disagree.

## The disk model (ADR-0135)

- **A path is source, derived or local, from `.gitignore` and what the
  turn's commands did.** Every tool call's command is a run, which the
  machine's observer sees (The channel into a lane); a turn's end classes what its runs
  and the write tools wrote, and keeps each run that made derived files as
  a recipe in the disk's registry (`.pinetrie-lane/recipes.json`). The
  rules are `@pinetrie/rules`' (`packages/rules/TECHNICAL.md`); the steps
  are the host's (`apps/pinetrie/host/TECHNICAL.md`, Lane work).
- **pine·trie runs no command of a project's.** Nothing installs or builds
  for a lane: its agent runs `pnpm install` as a developer would after a
  clone. There is no declared recipe; `lanes.install`, `installWhen` and
  `installCaches` are not read.
- **Every run starts on a disk whose recipes hold.** At each container
  start, whatever made the disk (a fork, a restore, a merge, another image,
  which a key holds), and right after an update's merge, since an agent's
  `catch_up` merges mid-run: each recipe whose key no longer holds has its
  outputs deleted, caches kept (`planStaleOutputs`). No site has to know it
  made a new state.
- **pnpm's store is never tracked** (`laneIgnores` lists `/.pnpm-store/`):
  pnpm keeps it at the root of the file system it installs on, which in a
  lane is the disk's root, and refuses a `node_modules` made with another
  store (S148).
- **The base is the base before it, checked out at accepted work**
  (`refreshBase`): the base snapshot restored, accepted work's commits
  fetched and checked out on it (the adapter's `BaseCheckout`), its facts written
  (`base.json`: its commits and `BASE_FORMAT`), then snapshotted. A refresh
  does nothing when the base holds the same commits, made the way bases
  are now (`isBaseCurrent`). It runs no command, so it holds nothing
  derived. A base made another way (`isCopyableBase`: one from before was
  made on a dependency layer, whose outputs no registry names) is not
  copied: the next starts empty, and the adapter's checkout is told so
  (`fresh`).

## Forks

- **A fork is its disk cloned from its source's snapshot, or the one its
  setup names, then the adapter's setup** (`planFork`, from `forkSource`):
  the steps a `ForkSetup` holds, which only the adapter's
  `LaneHistory.forkSteps` makes. Once they ran, the fork calls the
  history's `begun`, on the lane's queue. Between them, one step
  removes `/workspace/.pineta-lane` (`OLD_LANE_CONFIG_DIR`, tagged
  `pre-rename:`): a snapshot of a lane made before the rename holds that
  folder, `laneIgnores` does not list it, and the adapter's first command
  could snapshot it into the working copy the clone carries. jj's setup is
  `packages/jj/TECHNICAL.md`'s (A lane's repo).
- **The base snapshot is made in a scratch lane that is no thread's**
  (`BASE_LANE`, a `BaseLane`): a container, a disk and snapshots are named by
  a `LaneOwner`, a thread's id or the base's, while a bookmark, a remote and
  a stack take a `ThreadId` alone, so the base cannot be given one
  (ADR-0117).
- **The base snapshot is accepted work's state** (`refreshBase`), and
  refreshes after an acceptance or a land. The adapter reads accepted work
  with its checkout bound to that read (`AcceptedNow`): `refreshBase` uses
  it in the step that read it and keeps it for nothing, so no state is
  ever turned back into the adapter's terms. `base.json` keeps its field
  name, `commits`, holding the same strings. A fork from it first waits for a
  refresh (`baseAtAccepted`): accepted work may have been set up or moved since.

## The channel into a lane

- **One channel per running lane is the only way in**: tools, the host's jj
  and git, `sync` and bundles. It is pi's `openChannel` over the runtime's
  `exec -i` (`helperCommand`), and a call takes 0.3–1 ms. An `exec` per
  call would take 25–70 ms (S39, S43, S128).
- **The lane runtime is on the host**, in the session's
  `runtime/<image tag>/` (`sessionFiles`)
  (`ensureRuntime`), extracted as a tar on a throwaway container's stdout
  (`EXTRACT`, `runInImage`): every runtime has that way out, and a slot of
  the lane VM shares it read-only like any other directory.
- **The helper runs on the lane runtime** (`runtimeNode`):
  `/pinetrie-runtime/node/ld-linux-aarch64.so.1 --library-path … node …`. The
  runtime is copied out of pine·trie's default image into
  `runtime/<image tag>/`: Node, the libraries `ldd` lists for it,
  glibc's loader, and in `bin/` static builds of core's `RUNTIME_PROGRAMS`
  (jj, rg, fd, sd). So the helper runs on any image, musl or glibc, with or
  without Node (S44), and every lane has those programs (ADR-0064). Only
  `bin/` (`RUNTIME_BIN`) goes on a lane's `PATH`, after the image's own;
  pine·trie's Node needs its loader.
- **The runtime's programs are static release builds**, pinned by `ARG`
  defaults in the default Containerfile (S88). Debian's rg and fd link glibc,
  and would not run on a musl image. `EXTRACT` copies each program in the
  list and fails naming one the image lacks, so the host stops at startup.
  `ensureRuntime` keeps a runtime only when its `bin/` holds every program
  (`runtimeComplete`), not only jj. sd 1.1.0 reports itself as 1.0.0.
- **Every tool call's command is a run (ADR-0135).** The helper launches
  it with its number in `PINETRIE_RUN` (`packages/pi/TECHNICAL.md`); the
  host's own `run` calls never are runs. The machine's observer, outside
  every lane (`packages/lanehost/TECHNICAL.md`, The machine role), tags the
  run as its first process execs in the lane's PID namespace, which the host
  registered as the link opened (`LaneRuntime.observe`), and reports each
  open, rename, unlink, mkdir, link and symlink of its processes, and each
  written file's last release, to the host, never through the lane. A
  lane's shape carries nothing for it but `SHARED_ENV`, by which the helper
  stamps its tools' shared accesses.
- **A project image must still supply** a POSIX `sh` (pi's `bash` falls back
  to `sh -c`) and git 2.41 or later. Git launches its own helper programs, so
  it cannot be carried in from outside the image. `checkImage` refuses an
  image without them, naming what it lacks.
- **pine·trie's default image carries python3**, and **Chromium's headless
  shell** and its libraries, in `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
  (ADR-0041). Its
  build is pinned by `PLAYWRIGHT_VERSION`: `prepareImages` takes it from the
  host, which resolves the app's `@playwright/test`, so a Playwright upgrade
  builds the image again. The image's `ENV` reaches an agent's commands, so
  `chromium.launch()` finds the browser with nothing set. A project image
  gets no such argument, no browser and no python3 unless it installs them.
- **Whether a lane runs the default image is known at startup**, before the
  images are built: the project has no `projectContainerfile(root)`. The
  host reads it once, as `prepareImages` does, and tells each lane's agent
  (`defaultImage`, ADR-0121): the browser and python3.

## Containers

- **A container is disposable; the disk is the lane.** Each lane's container
  is labelled `pinetrie.spec=<hash>` (`SPEC_LABEL`), a hash of the runtime's
  spec for its shape (`specHashOf`). `planContainer` decides at each start:
  - missing: create it;
  - its label differs, or it has none: recreate it on the same disk;
  - stopped: start it;
  - running with the same label: nothing to do.

  A container made anew starts from what `planStartFrom` decides: its
  disk; else its newest snapshot (a restored root); else nothing, and the
  lane is retired: a branch from it continues. Both decisions are in
  `plan.ts`.
- **A disk restored from a snapshot gets the current names**
  (`pre-rename:`). A snapshot of a lane made before b05e2252 holds
  `pineta/<lane>` and `.pineta-lane/` (S114): `bookmarkOf` would find no
  bookmark, and jj ignores a `JJ_CONFIG` that names no file (exit 0), so
  `immutable_heads()` would be the builtin. After the restore,
  `startContainer` reads what is there (`oldNamesOnDisk`), plans
  (`planOldNamesOnDisk`: the folder moved first, then the lane's two
  bookmarks renamed, `pineta/fetched/*` deleted) and runs the plan. A start
  from the lane's own volume does none of it: the one-off migration renamed
  those. Remove both once no snapshot from before the rename remains.
- **A lane's home is on its disk** (`LANE_HOME`,
  `/workspace/.pinetrie-lane/home`, ADR-0135): what tools keep there,
  caches and config, persists and travels with forks, and is never committed.
  The helper creates it when it starts.
- **A lane's container is stopped after every run** (`runEnded` in the
  host's `work/containers.ts`); the disk needs nothing more. The next run
  starts it again.
  Processes the agent started, dev servers included, end with the run. The
  agent is told so (ADR-0121).
- **What reaches existing lanes this way:** a rebuilt image, changed grants,
  links or shared directories. The arguments are fixed when a container is
  created, and before labels existed the host only restarted it. A container
  made before labels is recreated once, at its next start: about a second,
  with the disk untouched (S45 item 6).

## Shared directories (ADR-0035)

- **A shared directory is your working copy's, mounted read-write** at the
  same relative path under `/workspace`, e.g. `/workspace/.plans` (S45 item
  1). It is a bind mount inside the lane's volume, not on the lane's disk, so
  it is never snapshotted, cloned, committed or landed. A snapshot holds only
  the empty mount point (S45 item 5).
- **Ownership and visibility.** The lane runs as root, but what it writes
  there arrives on the host owned by you. Changes are visible at once
  between the host and every lane (S45 items 2 and 3).
- **On the Mac, the working copy's read-only view of a shared directory
  lags** (`/mnt/host-working-copy/.plans` beside `/workspace/.plans`): a
  rename, an append or a delete made through one shows through the other
  about 1 s late, since the VM sees them as two entries (S178, S187). New
  files and rewrites show at once. A lane made before a directory it reads
  read-only was widened to read-write reads it so, with the same lag,
  until its next start.
- **One settled list** (ADR-0146): `lanes.shared` joins your file's
  entries, the project's `pinetrie.json` as accepted work holds it (narrowed
  per lane, A lane's config, below) and your file for the project, in that
  order, each once. `planShared` takes that list and refuses:
  - absolute paths, and paths that leave the project;
  - anything in `.git`, `.jj` or `node_modules`;
  - a path holding files the project tracks. jj's adapter gathers it
    (`@pinetrie/jj`'s `prepareShared`, with `jj file list`).

  Each refusal is logged with its reason, and the rest still apply.
  A config file that cannot be read or parsed is refused whole, and the
  host says why (`@pinetrie/config`).
- **A lane's config is a fact of a state (ADR-0135).** `lanes` in
  `pinetrie.json` decides what a lane may do (`LaneAuthority`: its grants
  and shared directories). A lane runs with accepted work's, less what its
  own copy dropped from the copy it started on (`effectiveLaneConfig`): it
  can give up a grant, and only accepted work gives one. A grant accepted
  after a lane started reaches it without a catch up. `configWidenings`
  says what one copy lets that another does not, which a write's reply
  (`configChangeNote`) and an offer's review show. Your repo's names come
  from your config and your working copy's file at startup: they find
  accepted work, so they cannot come from it.
- **A shared file has a lineage of versions (ADR-0135).** Every write into a
  shared directory is attributed and numbered: a run's, from the
  observer's opens and releases; a read or write tool's, from the stamps
  the helper takes; yours, from the host's watcher. A version is a stamp,
  size and ctime, which a lane and the host read alike (S169), never a
  hash. A write based on a version another write replaced is concurrent.
  The rules are `@pinetrie/rules`' (`sharedTouches`, `planSharedLineages`),
  the lineages and the watcher the host's (`apps/pinetrie/host/TECHNICAL.md`,
  `shared.ts`, `shared-watch.ts`).
- **No repo may track a shared directory.**
  - **In a lane,** the host writes the session's `lane-git/ignore`
    (`laneIgnores`: each of core's `DISK_OWN_ROOTS`, the one list of the
    paths pine·trie keeps on a disk; `/.pnpm-store/`; each shared
    directory), for every kind of project, each time the shared directories
    are prepared and before they are in force. It mounts its
    directory read-only at `/pinetrie-git`, and names the file as git's
    `core.excludesFile` through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and
    `GIT_CONFIG_VALUE_0`. jj reads it too (S45 item 7), so every repo in the
    lane ignores those paths from the container's first moment: the base,
    every fork, and disks made before a directory was shared.
  - **Why not the lane repo's `.git/info/exclude`:** a line there works only
    if it is written before jj first snapshots with the mount present. A jj
    command that ran first tracks the files, and adding accepted work later does
    not untrack them (S45 item 4).
  - **In your repo,** a shared directory nothing already ignores is added to
    `.git/info/exclude`: the only line pine·trie writes there. `git
    check-ignore` decides, so your global git ignore counts.

## What the host attaches (ADR-0140)

- **A lane spec's `attached` is a service of the host's, unnamed here:** a
  socket of the runtime's (`hostSocket`, where it is mounted in the lane),
  further mounts, variables, and shell commands started in the background
  at each start of the container (`starts`). `planShape` puts its mounts
  after `planMounts`', and its variables before pine·trie's own, so a
  variable of pine·trie's always wins. Lanes' ssh is its one user
  (`@pinetrie/ssh`, `apps/pinetrie/host/work/ssh.ts`); this package never
  imports it.
- **`LaneGrants.ssh` is only a grant:** the project lets lanes ask for their
  owner's ssh identity (`lanes.ssh.personal: true`). It rides the grants' model
  (`effectiveLaneConfig`): a lane can give it up, and only acceptance
  widens it. What it means is the host's.
- **`sessionFiles`' `laneSsh` and `sshSecret`** are the files every lane
  holding an identity mounts at `/pinetrie-ssh`, and the secret its token
  is made under; the app writes both.
- **`KILL_SSH`** ends every `ssh` process in a lane, by its name in `/proc`,
  which every image has: a revoke's backstop for a session that went around
  the host.

## Mounts, and granted host paths (ADR-0036)

- **Every mount is one `Mount { source, target, readonly }`**, in one list
  from `planMounts`: your working copy, pine·trie's install and runtime, the
  ignore file's directory, links, grants, shared directories and granted
  host paths, in a `ContainerShape`. A runtime renders each, and does not
  know what a mount is for.
- **On the Mac, a host's slots hold every directory any of its lanes
  mounts** (`slotMounts`): the base lane's mounts, every shared directory
  accepted work and your config allow, and what ssh attaches. The base
  lane's spec carries no shared directory, so they are added there: a lane
  mounting one no slot holds cannot be made. A slot is filled once, so
  what accepted work adds later goes in a slot of its own before the new
  config is in force, and reaches lanes at their next start (ADR-0141).
  Your config's own shared directories are read at startup, and change
  with a restart.
- **A handle's link is opened again after it fails or its helper exits**
  (`laneHandle`): it never keeps a dead channel, so the next call after a
  helper dies opens a new one.
- **Any path can be mounted:** Docker's API takes each mount as JSON, so a
  path with a comma and a colon, which the CLI's `--mount` and `-v` could
  not both name (S46 item 4), is no trouble.
- **Granted host paths** (`planHostMounts`) are the roots of the commands pi
  loaded, read-only at `/mnt/host` and their host path (`hostPathInLane`), so
  none can shadow a directory of the image's (S46). Nested roots collapse. A
  root that is, or holds, your home directory, `/` or one of pine·trie's own
  directories (`own`: the config and data directories, which hold
  credentials, service keys and sessions) is refused. A folder inside one,
  such as a skill folder in the config directory, is allowed: it lies
  inside, and does not hold it. A project's own skills are not a host path:
  a lane reads them in its own copy.
- **A change to them recreates lanes:** they are in the container's spec,
  and so in its hash.

## The queue

- **One serial queue per lane** (`createQueue`) carries everything that
  changes a lane's disk from outside a tool: the start, a fork's setup, each
  turn's commit and snapshot, the bundle, the stop and trim. Whatever
  reaches the lane's history does so through `withHistory` (The ports),
  which queues it. A tool's gate is
  the queue's tail, so a snapshot cannot overlap the next turn's writes. A
  failed start or fork (`fatal`) breaks the gate, so tools fail with its
  error, until the lane is started again.
- **A host tool may queue a merge during a run** (`catch_up`, ADR-0080):
  the run holds no part of the queue, so the merge runs after the turn's
  snapshot while the call waits on it (S103 item 1). The gate holds back
  only a call that starts after: one already running would write while jj
  checks out the merge, which is why `catch_up` must be alone in its
  batch.
- **jj's bundle is made on the lane's queue; the owner of your repo imports
  it** (`@pinetrie/jj`'s `importLane`, a command), which tools never wait
  on. The owner observes the import, and the moved ref marks the lane's
  offer for a refresh (`apps/pinetrie/host/jj/offers/`).

## Tests

- **`plan.test.ts`**: the planners. jj's are `@pinetrie/jj`'s.
- **`boundary.test.ts`**: the package names jj as a command nowhere but its
  image check, and exports none of jj's names.
- **`history-port.test.ts`**: the brands, by type: a merge takes only a
  `ReadyCopy`, `planFork` only a `ForkSetup`, `refreshBase` only a
  `BaseCheckout`.
- **`lane.test.ts`**: the queue, and that each file a lane is pointed at
  inside pine·trie's mount (`HELPER`, each kind's `laneNote`) exists in the install.
- **`runtime.test.ts`**: `runtimeComplete`, and that `EXTRACT` copies every
  program in `RUNTIME_PROGRAMS`.
- **`lanes.test.ts`**: the executor, the helper's command, config files
  and the handle. A lane's whole life against jj and git, in throwaway
  repos, is `packages/jj/repo.test.ts`, and the port suite against jj is
  `packages/jj/lane/history.test.ts`: it checks the history algebra's laws
  against jj, through hooks jj's harness supplies, and runs against any
  adapter's harness.
- **`e2e:lanes`** (`apps/pinetrie/e2e/lanes.ts`): the same in real containers,
  with a repo in a fork's `/tmp` for the config's scope, an agent's own
  `jj commit` reaching its offer and a branch, and the contract
  test. The `main` section alone takes about 2.5 minutes on the Mac. Its `images` section also runs
  the runtime's rg, fd and sd and the `grep` and `find` tools on Alpine, and
  launches Chromium, through pine·trie's Playwright, and python3 on the default
  image. Its `commands` section
  reads skill files at `/mnt/host`, and checks what a real lane's prompt
  tells it about itself and that the note it names is there (ADR-0121). It
  has seven scenarios (`apps/pinetrie/e2e/lanes/`), `main`, `images`,
  `shared`, `commands`, `catch-up`, `recipe` and `contract`, and
  `PINETRIE_SCENARIO` picks some. `recipe` is ADR-0135's: a turn's record
  classes what its runs wrote, and a catch up that changes what a recipe
  read removes what it made, its cache kept.
  It runs on Docker, and where Docker cannot run lanes, each scenario
  reports SKIP with the host's own reason (`runtimeProblem`).
  Its hosts pass their own `userConfig`, so the person's own lane config
  never applies. Each
  suite-level mutation in `scripts/mutations/lanes.ts`, `jj.ts` and
  `docker.ts`, among others, runs only the scenario its check is in, and
  stops at that check. Each on `plan.ts` proves a fact about a real lane
  that a unit test cannot: `sync`, a
  read-only mount, a shared mount seen both ways, the git ignore variables,
  jj's config scope, an agent's own commit, the image's browser and python3,
  the runtime's rg.
  `planContainer`'s and `planStartFrom`'s rules are unit mutations. These
  are all that `e2e:lanes` proves by mutation: the host's lane work and offers
  are proven by unit tests (`apps/pinetrie/host/TECHNICAL.md`).
- **The `contract` scenario is Docker's:** the checks in
  `packages/docker/TECHNICAL.md`.
