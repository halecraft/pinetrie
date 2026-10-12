# `@pinetrie/lanes`: technical notes

This package's one job is what a lane is and what runs in it: the
container's shape, mounts, grants, lane config, jj and git in a lane, forks,
turns, bundles, the base, the queue and the handle (ADR-0032 to ADR-0034).
It defines the `LaneRuntime` port and implements no runtime (ADR-0130):
`@pinetrie/docker` does, and the app composes it
(`apps/pinetrie/host/work/runtime.ts`). Every lane has its own copy: none
works directly in a directory (ADR-0102). Your repo is `@pinetrie/repo`'s
(`packages/repo/TECHNICAL.md`), which builds on this package: what a lane
also runs, through a `Runner` it is given, is here (`laneBase`,
`REVISION_READ`, `commitsOf`), and so are the names both sides use
(`bookmarkName`, `laneTipName`, `offerBookmark`, `DEFAULT_REPO`). This
package never imports `@pinetrie/repo`. It declares only `@pinetrie/core`
(`workspace.test.ts`), and the client may not depend on it. It never imports
pi (ADR-0003): the channel into a lane is `packages/pi`'s, and the host hands
it in as an `OpenLink`.

The evidence is in `docs/findings/`: S36 for the jj rules, S39 to S44 for
containers, disks and the helper, S122 to S131 for Docker and the lane VM.

## The runtime port (`runtime-port.ts`)

- **A lane's container is decided once, as a value** (`planShape`): a
  `ContainerShape` holds its name, its lane (its disk, at `/workspace`), the
  image, memory, mounts (`planMounts`), environment, ssh and `nested`, and no
  runtime's flags. A runtime renders it (`runSpec`); the hash of that value
  is its spec label (`specHashOf`).
- **Planners return values; a runtime turns them into commands.** A plan is a
  list of `Step`s: a `LaneStep` (a command in the lane, through its channel)
  or a `RuntimeOp` (a `DiskOp`, or a container made from a shape), carried
  out by `execute` through `Runners.runtime`. A list of lane steps alone
  needs no runtime, so `@pinetrie/repo` never has one.
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

## Where things are

- `plan.ts`: every decision, pure. It covers the container's arguments,
  grants, link mounts, fork, turn, bundle and base steps, the images and
  their tags (`planImages`), and what the host finds at startup.
- `execute.ts`: runs a list of `LaneStep`s in order, on the host or in the
  lane.
- `run.ts`, `bookmarks.ts`, `revisions.ts`, `merge.ts`: jj and git as
  `Runner`s, and the jj logic over them. `revisions.ts` holds the reader
  of an accepted-offer commit's row (`ACCEPTED_OFFER_COMMIT_ROW`,
  `parseAcceptedOfferCommits`), which your repo's reads use too.
  `planJoins` (`plan.ts`) decides which accepted-offer commits an update
  joins.
- `host.ts`: startup facts, lane configs and shared directories. Its reads
  of your repo (`jjIn`, git from its root) are the one exception to "only
  `@pinetrie/repo` runs jj on your repo": they only read, at startup, before
  the owner of your repo starts. Its one write there is a file, the exclude
  file. `prepareProjectDir` adds `/.pinetrie/` to it, once from `server.ts`
  before the store opens and again in `prepareContainerHost`, which then writes
  nothing (ADR-0086); `prepareShared` adds shared directories.
- `planProjectDir` (`plan.ts`) decides a project's root from `RootFacts`,
  or refuses the folder (`ProjectDirRefusal`, worded by `projectDirWords`);
  `planRoot` only maps its result for a runtime's startup planner
  (`planContainerHost`). `pinetrieDir` is the layout
  of `.pinetrie/`: the store, snapshots, the runtime and `lane-git`.
- `image.ts`, `runtime.ts`: the image and the lane runtime. `image.ts`
  gathers what `planImages` needs and builds what it plans.
- `runtime-port.ts`: `LaneRuntime`, every call the host makes to a
  runtime, and `DiskOp`. This package implements no runtime: Docker's is
  `@pinetrie/docker`'s (`dockerRuntime`).
  `lane.ts`: the container, the queue, and the handle. `base.ts`: the base snapshot, and a lane's base as its
  history names it (`laneBase`), read from the lane's repo or yours.

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

## The base and the recipe (ADR-0131)

- **ADR-0135, proposed, would replace this section.** A recipe would be
  any recorded run of a tool call that made derived files, keyed by what it
  read, not a declared command. A disk for a new state would carry each
  output whose key still holds there, and pine·trie would run no recipe
  itself. Until it is accepted, what follows holds.
- **A recipe** (`Recipe`, `lanes.install`) is how a disk's dependencies are
  made: a command, the tracked files whose content keys it (its inputs,
  `lanes.installWhen`, one or a list), and directories carried from one
  build to the next (`lanes.installCaches`). A pnpm repo with no config
  gets `pnpm install --frozen-lockfile`, keyed by `pnpm-lock.yaml`, with
  `.pnpm-store` its cache: pnpm keeps its store at the root of the file
  system it installs on, and refuses a `node_modules` made with another
  store (S148), so the store stays there. No repo in a lane tracks a cache
  (`laneIgnores`).
- **A dependency layer** (`deps-<key>`, `depsSnapshot`) is a disk on which
  the recipe ran once, named by what made it (`depsKey`: the recipe, the
  content of its inputs at the commits, `inputsHash`, the lane image, and
  `BASE_FORMAT`). It is built on a fresh disk, with only the recipe's
  caches carried in from the newest layer by reflink (`DiskOp`'s `carry`,
  about 300 ms for a 329 MB store, S148): it holds nothing an older layer
  held, so a package deleted from accepted work leaves nothing behind.
- **The base is a layer and a checkout** (`refreshBase`): the layer for
  accepted work's key restored (built first if missing), accepted work's
  commits fetched and checked out on it (`planBaseCheckout`), its facts
  written, then snapshotted. It never restores an older base. With no
  recipe, a layer is a checkout alone, keyed by the image, so a refresh
  still fetches only what is new. A refresh does nothing when the base holds
  the same commits on the same layer (`isBaseCurrent`).
- **A recipe's run is planned in two halves around a gather** (`runRecipe`):
  `planRecipe` removes the outputs the disk recorded, snapshots it
  read-only, runs the command, and snapshots it again; the runtime's `diff`
  of the two says what it made; `planRecipeRecord` records its outputs
  (`addedRoots`: the topmost paths it added, never a cache) in
  `.pinetrie-lane/derived.json` and deletes the two snapshots. A failed run
  records its outputs too, with the key before it, so the next run removes
  them and runs again.
- **Old layers go after each base build** (`planDepsRetention`): every one
  but the base's and the three newest. A fork copies its layer when it
  starts, so a layer serves only forks to come, and is built again from its
  key when one needs it.

## Forks

- **A fork with no revision above it starts from its thread's base**
  (`planForkSetup`, ADR-0104): on accepted work, an empty commit on accepted work's
  commit (`planAcceptedStart`); on a WIP, a copy of the WIP made in the lane
  (`planWipCopy`): a commit on accepted commit under the WIP, with the WIP's
  files restored. Never the WIP's own commits: the lane's tip, a remote
  bookmark and immutable in your repo, would make them immutable too (S48
  item 11), and your WIP would freeze. Either commit carries
  `Pinetrie-Base: <bookmark>@<commit>` (`baseMessage`), the lane's ledger of
  its base. The base disk holds accepted work's dependencies, so a fork from
  a WIP whose recipe's inputs differ starts from a dependency layer of its
  own, made at the WIP's commit if missing (the host's `create.ts`): no fork
  installs.
- **The base snapshot is made in a scratch lane that is no thread's**
  (`BASE_LANE`, a `BaseLane`): a container, a disk and snapshots are named by
  a `LaneOwner`, a thread's id or the base's, while a bookmark, a remote and
  a stack take a `ThreadId` alone, so the base cannot be given one
  (ADR-0117).
- **The base snapshot is accepted work's commit** (`refreshBase`), and
  refreshes after an acceptance or a land. A fork from it first waits for a
  refresh (`baseAtAccepted`): accepted work may have been set up or moved since.
- **`jj new` runs first in a fork** (`planForkSetup`), after one step that
  removes `/workspace/.pineta-lane` (`OLD_LANE_CONFIG_DIR`, tagged
  `pre-rename:`). A snapshot of a lane made before the rename holds that
  folder, `laneIgnores` does not list it, and `jj new` would snapshot it
  into the working copy the clone carries. A clone carries its
  parent's working-copy change. Without `jj new`, the fork's first turn reuses
  that change's id, and your repo sees a divergent change (S42 item 2).
  `repo.test.ts` (`@pinetrie/repo`) forks a lane's repo and checks that your repo has no
  `divergent()`. Its mutation drops `jj new`.
- **Inherited history is immutable in the fork.** Its config is a file on its
  own disk (`JJ_CONFIG=/workspace/.pinetrie-lane/jj.toml`), so forks of forks
  inherit it. It sets `immutable_heads()` to
  `builtin_immutable_heads() | <fork commit>` (`forkConfig`). A parent's fork
  point is an ancestor of its child's, so nothing needs reading from the lane.
  jj's `--repo` config lives in the home directory, which in a lane is the
  container's own and not on its disk.
- **That setting applies to `/workspace` only.** `JJ_CONFIG` reaches every
  jj command in the container, and a repo that lacks the fork commit fails
  every command under it (S50). So `forkConfig` writes it in a
  `[[--scope]]` with `--when.repositories = ["/workspace"]`. jj matches the
  repo and every path under it, so a repo nested inside `/workspace` still
  gets it. A lane made before the scope keeps its unscoped file: only a
  fork's setup writes it.
- **A base with several parents** (your `@` is a merge) is committed once,
  empty, so the lane's bookmark names one commit.

## Moving commits

- **By commit id, into a lane**: `fetchById` fetches from `/mnt/host-working-copy` only when
  the disk lacks the commit, and puts the commit on a branch
  (`refs/heads/pinetrie/fetched/<i>`). jj imports only branches, remote branches
  and tags, so it does not see a commit fetched with no ref (S44 item 7).
  When your `@-` was rewritten, that branch moves sideways, and the import
  (`--ignore-working-copy`) abandons the commit it named and rebases its
  descendants. On a base restored from a dependency layer the working-copy
  commit is one of them, so the working copy goes stale: `planBaseCheckout`
  runs `jj workspace update-stale` before `jj new`, which does nothing when
  it is fresh (S74).
  It fetches every commit it names when the disk lacks any, and git skips a
  wanted commit the disk already holds, so naming one of the lane's own is
  harmless, though a caller names only what the lane may lack (S83).
- **By bundle, into your repo** (`planBundle` here, `planImport` in
  `@pinetrie/repo`): `git bundle create -` in the lane, written to a host file
  through the channel as bytes, then, in your repo, `git fetch <file>
  +refs/heads/pinetrie/<lane>:refs/remotes/pinetrie-<lane>/tip`.
  The bundle excludes what your repo has (`^<have>`). A bundle of the whole
  history is 1.1 MB and 253 ms on pine·trie's repo, against 8 KB and 29 ms for
  one commit (S43 item 8).
- **In your repo a lane's history is a remote bookmark**, `tip@pinetrie-<lane>`
  (ADR-0105). jj imports a ref under `refs/remotes/` with no git remote
  configured, keeps its commits out of your default log, and treats them,
  and their ancestors, as immutable with its builtin config (S48 items 11 and
  19). `laneRefSteps` (`@pinetrie/repo`) is the one writer of the ref besides
  the fetch: archiving deletes it, restoring writes it back. In the lane's
  own repo the bookmark stays a local `pinetrie/<lane>`; `laneTipIn`
  (`@pinetrie/repo`) reads the one in yours, `bookmarkOf` the lane's.
- **Every fetch into a colocated repo ends with
  `jj --ignore-working-copy git import`**, in your repo as the host
  (`planImport`). A jj command run with
  `--ignore-working-copy` imports no git refs. A plain `jj git import`
  snapshots the working copy as well, recording your uncommitted edits into
  `@`: 107 ms against 12–47 ms (S44 item 8).
- **A fresh disk's checkout is `git init` and `jj git init --colocate`,**
  then a fetch by id (`planBaseCheckout`). `jj git clone` refuses a directory that is not empty, and a
  fresh volume holds `lost+found` (S44 item 6). A clone would also fetch every
  bookmark and check out nothing (S43 item 5).
- **`PINETRIE_GIT=1`** is set on every host command `run` starts. A git shim
  that refuses git writes in a jj repo when an agent is driving lets it
  through. The agent's own commands run through pi's environment, never
  through `run`, so they never carry it.

## The channel into a lane

- **One channel per running lane is the only way in**: tools, the host's jj
  and git, `sync` and bundles. It is pi's `openChannel` over the runtime's
  `exec -i` (`helperCommand`), and a call takes 0.3–1 ms. An `exec` per
  call would take 25–70 ms (S39, S43, S128).
- **The lane runtime is on the host**, in `.pinetrie/runtime/<image tag>/`
  (`ensureRuntime`), extracted as a tar on a throwaway container's stdout
  (`EXTRACT`, `runInImage`): every runtime has that way out, and a slot of
  the lane VM shares it read-only like any other directory.
- **The helper runs on the lane runtime** (`runtimeNode`):
  `/pinetrie-runtime/node/ld-linux-aarch64.so.1 --library-path … node …`. The
  runtime is copied out of pine·trie's default image into
  `.pinetrie/runtime/<image tag>/`: Node, the libraries `ldd` lists for it,
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
- **Two levels, merged:** the user's lane config
  (`$XDG_CONFIG_HOME/pinetrie/config.json`, only its `lanes.shared`), then the
  project's `pinetrie.json`. `planShared` refuses:
  - absolute paths, and paths that leave the project;
  - anything in `.git`, `.jj`, `.pinetrie` or `node_modules`;
  - a path holding files jj tracks. Checked with `jj file list`, not git's
    index, which can lag in a colocated repo.

  Each refusal is logged with its reason, and the rest still apply.
  Both files are read with `readConfigFile`: a missing file is empty, and
  so is one that cannot be read or parsed (`broken`), which the host logs
  with its reason.
- **No repo may track a shared directory.**
  - **In a lane,** the host writes `.pinetrie/lane-git/ignore` (`laneIgnores`:
    `/.pinetrie-lane/`, `/lost+found/`, each shared directory). It mounts its
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
    `.git/info/exclude`, as `/.pinetrie/` is. `git check-ignore` decides, so
    your global git ignore counts.

## Mounts, and granted host paths (ADR-0036)

- **Every mount is one `Mount { source, target, readonly }`**, in one list
  from `planMounts`: your working copy, pine·trie's install and runtime, the
  ignore file's directory, links, grants, shared directories and granted
  host paths, in a `ContainerShape`. A runtime renders each, and does not
  know what a mount is for.
- **Any path can be mounted:** Docker's API takes each mount as JSON, so a
  path with a comma and a colon, which the CLI's `--mount` and `-v` could
  not both name (S46 item 4), is no trouble.
- **Granted host paths** (`planHostMounts`) are the roots of the commands pi
  loaded, read-only at `/mnt/host` and their host path (`hostPathInLane`), so
  none can shadow a directory of the image's (S46). Nested roots collapse. A
  root that is, or holds, your home directory, `/` or pi's agent directory
  (`auth.json`) is refused. A package inside the agent directory is
  allowed: it lies inside, and does not hold it.
- **A change to them recreates lanes:** they are in the container's spec,
  and so in its hash.

## The queue

- **One serial queue per lane** (`createQueue`) carries everything that
  changes a lane's disk from outside a tool: the start, a fork's setup, each
  turn's commit and snapshot, the bundle, the stop and trim. A tool's gate is
  the queue's tail, so a snapshot cannot overlap the next turn's writes. A
  failed start or fork (`fatal`) breaks the gate, so tools fail with its
  error, until the lane is started again.
- **A host tool may queue a merge during a run** (`catch_up`, ADR-0080):
  the run holds no part of the queue, so the merge runs after the turn's
  snapshot while the call waits on it (S103 item 1). The gate holds back
  only a call that starts after: one already running would write while jj
  checks out the merge, which is why `catch_up` must be alone in its
  batch.
- **The bundle is made on the lane's queue; the owner of your repo imports
  it** (`@pinetrie/repo`'s `importLane`, a command), which tools never wait
  on. The owner observes the import, and the moved ref marks the lane's
  offer for a refresh (`host/offers/`).

## Running jj and git (`run.ts`)

- **Every jj command takes `-R <root>`**: `laneJj(runner)` with `-R
  /workspace` in a lane, and `@pinetrie/repo`'s runners on your repo. A jj
  command run from the wrong directory acts on whatever repo surrounds it
  (S36 item 28). `jjIn` alone runs from a directory: to ask where a repo is,
  and for the startup reads above.
- **A path argument is read from the process's directory, not `-R`'s.** Name
  files with the `root:"…"` fileset, as `revisionsIn` and `conflictContent`
  do.
- **One bookmark in a revset is `bookmarkRevset(name)`**: `bookmarks(exact:…)`
  with the name quoted (`revsetName`), so a name is never parsed as a
  revset.
- **The host's trailers** (`Pinetrie-Thread`, `Pinetrie-Lane`, `Pinetrie-Entry`,
  `Pinetrie-Base` and an offer's ledger) are written and read in one file,
  core's `trailers.ts`: a turn's message (`revisionMessage`,
  `entryOfMessage`), a base's (`baseMessage`, `parseBase`, `baseOf`), an
  offer's, and the revset that finds commits by one (`trailerRevset`, here
  in `newestBase`). A format lanes or repo must read or write lives in
  core.
  - **The readers also read `Pineta-*`** (`READ`, `pre-rename:`): commits
    made before the rename are immutable. Writers write `Pinetrie-*` only.
  - **A base is read by kind, never by accepted work's bookmark**
    (`baseOf`, ADR-0100): a name with the WIP prefix is that WIP, any other
    is accepted work. New bases write `accepted@<commit>`; one written as
    `pinetrie-onto@` or `pineta-onto@` reads as accepted work too, with no
    special case, and so would one under any later name of the bookmark.
    `planLaneRead` and `laneBase` take the kind from it.
- **Decide from exit status, never from printed text.** Output a program
  reads comes from a `-T` template. `execFile` reads all of it: jj exits 3 on
  a broken pipe.
- **`JJ_EDITOR=false`** (`NO_EDITOR`, from core) makes a command that wants
  an editor fail at once rather than hang (S36 items 13, 21). A lane's
  container sets the same variables.

## Revisions and updates (`revisions.ts`, `merge.ts`)

- **`commitTurn`** snapshots, reads `@`'s `empty` and its parents in one
  `jj log`, and decides with `planTurnCommit`:
  - `@` has changes: `jj commit` with the title and two trailers,
    `Pinetrie-Entry` and `Pinetrie-Lane`, then the lane's bookmark moves there;
  - `@` is empty and its one parent descends from the bookmark: the agent
    committed in the turn, with jj or git, and that commit is the turn's
    revision. The bookmark moves to it, untouched, without trailers (S56).
    Without this, the offer lacked the commit, and a branch at the turn ran
    `jj new` on the bookmark's commit and lost its files;
  - otherwise null. A parent on another line (a split's stack, built on the
    offer's start) or a merge is never adopted.

  The caller passes the bookmark it read (`turnDone` also records it as the
  prompt's `newest`). The ancestry query (`isAncestor`) runs only when `@`
  is empty and its one parent is not the bookmark: most turns change
  nothing, and cost no extra command. The same `jj log` reads `@`'s and
  each parent's `conflict`, so `commitTurn` also says whether the turn's
  commit, or the bookmark when it has none, is conflicted; only then does
  `turnDone` list the files (`conflictedFilesAt`) into the record, which a
  branch's warning reads (ADR-0072).
- **`copyFacts`** (ADR-0080) reads where the working copy sits against the
  lane's bookmark, after a snapshot: `@`'s parents, the bookmark, and
  whether the one parent descends from it (`isAncestor`, asked only when it
  is not the bookmark). Every catch-up checks it before it merges
  (`planCopyReady`, `@pinetrie/rules`): a split's stack as the working copy is
  off the lane's line.
- **`commitToBookmark`** is the one tail of every commit the host makes in
  a lane: `jj commit`, read `@-`, move the lane's bookmark. `commitTurn`,
  `mergeBase` and the mark of a move to accepted work all end with it.
- **`changedPaths`** is a turn's paths, from the bookmark before it to its
  commit, made or adopted, which its revision records (ADR-0106): `jj diff
  -T PATH_LINE`, `json(path)` a line, which is from the repo's root
  whatever the process's directory, and quotes any character (S70). An
  update's changed files use it too. **Not git:** git reads a conflicted jj
  commit as every side's whole tree under `.jjconflict-base-<n>/` and
  `.jjconflict-side-<n>/`, plus `JJ-CONFLICT-README`, so a turn that
  resolved one file in a repo of 694 counted 2084 (S99).
- **`conflictedFilesAt(jj, rev)`** is the one read of a commit's conflicted
  files (`jj file list -T 'if(conflict, …)'`), in a lane and in your repo;
  it throws, and a caller that reads none on failure says so at the call.
  `conflictsIn` snapshots the lane first, then reads `@`.
- **An update merges the thread's base** (`mergeBase`, ADR-0104): the
  line's commit, or a fresh copy of the WIP (`planWipCopy`) made on the
  lane's previous copy, so conflicts the lane already resolved do not come
  back. Or the newest commit of the thread it branched from (`planMerge`'s
  `parent`, ADR-0072), merged as accepted work's commit is but with no
  `Pinetrie-Base`: ancestry says what the lane holds of it. Accepted work's merge carries `Pinetrie-Base`, a WIP's copy its own, and
  `newestBase` reads the newest one in a lane's history: its base, and
  where its offers start. `laneBase` reads it in the lane's own repo too
  (`bookmarkRevset`), where a lane with none is null: that repo has no
  line bookmark to find a start on.
- **An accepted-offer commit the lane holds is joined to its source
  first** (`planJoins`, `mergeBase`, S102, ADR-0079). An accepted-offer
  commit is a copy of a lane's work on accepted work, naming the commit it
  copies (`Pinetrie-Source`). Merged as history says, its base is that
  commit's `Pinetrie-Start`, from before that work, so the work came in
  twice: any edit accepted work made to it since conflicted. So a join, a commit
  merging the source with the accepted-offer commit (the same changes,
  so clean), goes first, and the update merges the lane, the last join and
  the base in one commit.
  - **Which accepted-offer commits:** those in `::<from> ~ ::<ours>` (`ACCEPTED_OFFER_COMMIT_ROW`, one `jj
    log`) naming any source the lane holds, a squash's included (S77 item
    6), read with `present()`.
  - **The order:** oldest first, each join on the last, so a later one's
    base holds the earlier ones.
  - **A conflicted join is abandoned:** an acceptance of an offer you edited where
    the lane wrote, merged as before.
  - **A join carries no trailer:** bases and accepted-offer commits are
    found by theirs.
  - **The update's titles and a conflict's `theirs` leave the accepted-offer commits out**
    (`withoutAcceptedOfferCommits`), and keep accepted work's commits under them.
  - **A WIP's copy has no accepted-offer commit in its history,** so a WIP thread joins
    nothing.
  - **The host's forecast starts from the same sources** (`catchUpFiles`,
    `@pinetrie/repo`): it diffs from the offer's start, which holds them,
    not from the base's start (S102 item 11).
- **`mergeUpdate` is an update's whole run in a lane** after its edits,
  on the lane's queue: `planMerge`'s steps (a fetch of accepted work's commit,
  or of the WIP's commit and its copy), the merge, a mark naming accepted work
  when a thread moves there with nothing to merge, then what the merge left:
  its files and the titles of what came in (`titlesOf`, one log), or each
  conflicted file's content and the revisions on each side that touched
  them. A WIP's copy fetches only the WIP's commit: its parent is the
  lane's own.
- **`revisionsIn` reads a side of a merge in one `jj log`**: the range's
  revisions that touched any of the files, each with those it touched, from
  `self.diff("<fileset>").files()` as JSON per line (S83). A side needs no
  `fork_point`: `fork_point(a | b)..b` is `a..b`, even with several fork
  points (S83).
- **The merge is committed at once,** even with nothing to resolve.
  Otherwise an empty merge stays the lane's working copy, which every snapshot
  rewrites. A mutation shows `repo.test.ts` fails without it.
- **Conflicts** are read with `conflictedFilesAt`, and a conflicted file's
  content with `jj file show`: the host cannot read a lane's disk.
- **A file both sides hold alike is merged as it is** (`heldAlike`): jj
  keeps a conflict when the merge's base is itself conflicted, as when a
  branch cloned at a conflicted catch-up and its parent resolved it alike
  (S99). `mergeUpdate` restores such files from the side merged in into the
  merge (`jj restore --into`, the bookmark following), then reads the
  conflicts again. With a clean base jj already takes them.
- **A clean update's changed files come from `changedPaths`**, the turn's
  read.

## Tests

- **`plan.test.ts`**: the planners. Your repo's are `@pinetrie/repo`'s.
- **`lane.test.ts`**: the queue, and that each file a lane is pointed at
  inside pine·trie's mount (`HELPER`, `LANE_NOTE`) exists in the install.
- **`runtime.test.ts`**: `runtimeComplete`, and that `EXTRACT` copies every
  program in `RUNTIME_PROGRAMS`.
- **`lanes.test.ts`**: the executor, the trailers' round trip, and
  `changedPaths` against git. A lane's whole life against jj and git, in
  throwaway repos, is `packages/repo/repo.test.ts`: every such test fetches
  into your repo, so it needs `@pinetrie/repo`, which this package may not
  import.
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
  `PINETRIE_SCENARIO` picks some. `recipe` is ADR-0131's: a package deleted
  from accepted work, or in a lane, leaves no output behind, and a turn's
  record names the ignored files it wrote.
  It runs on Docker, and where Docker cannot run lanes, each scenario
  reports SKIP with the host's own reason (`runtimeProblem`).
  Its hosts pass their own `userConfig`, so the person's own lane config
  never applies. Each
  suite-level mutation in `scripts/mutations/lanes.ts`, `repo.ts` and
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
