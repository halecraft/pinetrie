# `@pineta/lanes`: technical notes

This package covers a lane's Linux container on its own disk, and the jj and
git run in it and in your repo (ADR-0032, ADR-0033, ADR-0034). It is the one
package that runs `container`, `jj`, `git` and `cp`. It declares only
`@pineta/core` (`workspace.test.ts`), and the client may not depend on it. It
never imports pi (ADR-0003): the channel into a lane is `packages/pi`'s, and
the host hands it in as an `OpenLink`.

The evidence is in `docs/findings/`: S36 for the jj rules, S39 to S44 for
containers, disks and the helper.

## Where things are

- `plan.ts`: every decision, pure. It covers the container's arguments,
  grants, link mounts, fork, turn, fetch and base steps, and what the host
  finds at startup.
- `execute.ts`: runs a list of `LaneStep`s in order, on the host or in the
  lane.
- `run.ts`, `bookmarks.ts`, `revisions.ts`, `merge.ts`: jj and git as
  `Runner`s, and the jj logic over them.
- `host.ts`: startup facts, lane configs and shared directories.
- `image.ts`, `runtime.ts`: the image and the lane runtime.
- `disk.ts`: snapshots, deletion, trim. `lane.ts`: the container, the queue,
  and the handle. `base.ts`: the base snapshot.

## Disks and snapshots

- **Every volume is journaled** (`--opt journal=ordered`, `createVolume`).
  With no journal, a clone taken while the lane writes is corrupt: 0 of 70
  were consistent in S41. With `ordered`, 687 of 687 were. `container`'s
  default volume has no journal.
- **`sync` comes before every snapshot** (`planSnapshot`). Otherwise files the
  lane wrote but had not flushed come out empty in the clone (S41 item 1).
- **A snapshot is `/bin/cp -c` of the volume's `volume.img`,** cloned to
  `<name>.tmp` and renamed into place, so no snapshot file is ever
  half-written. GNU `cp` has no `-c`.
- **The image swap is unsupported.** A volume made from a snapshot is
  created by `container`, then has its `volume.img` replaced by a clone
  (`planDisk`). `container` 1.4.1 does not promise that works: a volume is
  its `entity.json` and an image read by path (S40). `e2e:lanes` runs a small
  soak on every upgrade: twenty clones taken mid-write, each checked with
  `e2fsck` and for every record the writer had `fsync`ed. Its mutation drops
  the journal.
- **Deleting a clone takes about 280 ms** (S40 item 4), so
  `removeSnapshots` deletes one after another, in the background.
- **Trimming**: after a run the host trims the stopped disk, so it gives
  back the space the lane deleted. `trim` runs a short-lived container with
  `CAP_SYS_ADMIN`; a lane's own container never has that capability.
- **Clone time rises with a disk's fragmentation, not its size**: 5–9 ms on
  a fresh disk, up to 0.6 s on one churned for minutes (S43 item 6, S40).
  Not isolated.

## Forks

- **`jj new` runs first in a fork** (`planForkSetup`). A clone carries its
  parent's working-copy change. Without `jj new`, the fork's first turn reuses
  that change's id, and your repo sees a divergent change (S42 item 2).
  `lanes.test.ts` forks a lane's repo and checks that your repo has no
  `divergent()`. Its mutation drops `jj new`.
- **Inherited history is immutable in the fork.** Its config is a file on its
  own disk (`JJ_CONFIG=/workspace/.pineta-lane/jj.toml`), so forks of forks
  inherit it. It sets `immutable_heads()` to
  `builtin_immutable_heads() | <fork commit>` (`forkConfig`). A parent's fork
  point is an ancestor of its child's, so nothing needs reading from the lane.
  jj's `--repo` config lives in the home directory, which in a lane is the
  container's own and not on its disk.
- **A base with several parents** (your `@` is a merge) is committed once,
  empty, so the lane's bookmark names one commit.

## Moving commits

- **By commit id, into a lane**: `fetchById` fetches from `/mnt/host-working-copy` only when
  the disk lacks the commit, and puts the commit on a branch
  (`refs/heads/pineta/fetched/<i>`). jj imports only branches, remote branches
  and tags, so it does not see a commit fetched with no ref (S44 item 7).
- **By bundle, into your repo** (`planFetch`): `git bundle create -` in the
  lane, written to a host file through the channel as bytes, then
  `git -C <root> fetch <file> +refs/heads/pineta/<lane>:…`. The bundle
  excludes what your repo has (`^<have>`). A bundle of the whole history is
  1.1 MB and 253 ms on Pineta's repo, against 8 KB and 29 ms for one commit
  (S43 item 8).
- **Every fetch into a colocated repo ends with
  `jj --ignore-working-copy git import`.** A jj command run with
  `--ignore-working-copy` imports no git refs. A plain `jj git import`
  snapshots the working copy as well, recording your uncommitted edits into
  `@`: 107 ms against 12–47 ms (S44 item 8).
- **A new base disk is `git init` and `jj git init --colocate`,** then a
  fetch by id. `jj git clone` refuses a directory that is not empty, and a
  fresh volume holds `lost+found` (S44 item 6). A clone would also fetch every
  bookmark and check out nothing (S43 item 5).
- **`PINETA_GIT=1`** is set on every host command `run` starts. A git shim
  that refuses git writes in a jj repo when an agent is driving lets it
  through. The agent's own commands run through pi's environment, never
  through `run`, so they never carry it.

## The channel into a lane

- **One channel per running lane is the only way in**: tools, the host's jj
  and git, `sync` and bundles. It is pi's `openChannel` over
  `container exec -i <lane> …`, and a call takes 0.3–1 ms. A `container exec`
  per call would take 50–70 ms (S39, S43).
- **The helper runs on the lane runtime** (`runtimeNode`):
  `/pineta-runtime/node/ld-linux-aarch64.so.1 --library-path … node …`. The
  runtime is copied out of Pineta's default image into
  `.pineta/runtime/<image tag>/`: Node, the libraries `ldd` lists for it,
  glibc's loader, and a static jj. So the helper runs on any image, musl or
  glibc, with or without Node (S44). Only `bin/` (jj) goes on a lane's
  `PATH`, after the image's own; Pineta's Node needs its loader.
- **A project image must still supply** a POSIX `sh` (pi's `bash` falls back
  to `sh -c`) and git 2.41 or later. Git launches its own helper programs, so
  it cannot be carried in from outside the image. `checkImage` refuses an
  image without them, naming what it lacks.

## Containers

- **A container is disposable; the disk is the lane.** Each lane's container
  is labelled `pineta.spec=<hash>` (`SPEC_LABEL`), a hash of its
  `container run` arguments. `planContainer` decides at each start:
  - missing: create it;
  - its label differs, or it has none: recreate it on the same volume;
  - stopped: start it;
  - running with the same label: nothing to do.
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
  (`$XDG_CONFIG_HOME/pineta/config.json`, only its `lanes.shared`), then the
  project's `pineta.json`. `planShared` refuses:
  - absolute paths, and paths that leave the project;
  - anything in `.git`, `.jj`, `.pineta` or `node_modules`;
  - a path holding files jj tracks. Checked with `jj file list`, not git's
    index, which can lag in a colocated repo.

  Each refusal is logged with its reason, and the rest still apply.
- **No repo may track a shared directory.**
  - **In a lane,** the host writes `.pineta/lane-git/ignore` (`laneIgnores`:
    `/.pineta-lane/`, `/lost+found/`, each shared directory). It mounts its
    directory read-only at `/pineta-git`, and names the file as git's
    `core.excludesFile` through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and
    `GIT_CONFIG_VALUE_0`. jj reads it too (S45 item 7), so every repo in the
    lane ignores those paths from the container's first moment: the base,
    every fork, and disks made before a directory was shared.
  - **Why not the lane repo's `.git/info/exclude`:** a line there works only
    if it is written before jj first snapshots with the mount present. A jj
    command that ran first tracks the files, and adding the line later does
    not untrack them (S45 item 4).
  - **In your repo,** a shared directory nothing already ignores is added to
    `.git/info/exclude`, as `/.pineta/` is. `git check-ignore` decides, so
    your global git ignore counts.

## Mounts, and granted host paths (ADR-0036)

- **Every mount is one `Mount { source, target, readonly }`**, in one list
  from `planMounts`: your working copy, Pineta's install and runtime, the
  ignore file's directory, links, grants, shared directories and granted
  host paths. `planRun` renders each with `mountArgs`, and does not know what
  a mount is for.
- **`mountArgs`:** `--mount` separates its fields with commas and `-v` with
  colons, so a path with a comma takes `-v`, and one with both cannot be
  mounted at all (S46 item 4).
- **Granted host paths** (`planHostMounts`) are the roots of the commands pi
  loaded, read-only at `/mnt/host` and their host path (`hostPathInLane`), so
  none can shadow a directory of the image's (S46). Nested roots collapse. A
  root that is, or holds, your home directory, `/` or pi's agent directory
  (`auth.json`) is refused, and so is one with both a comma and a colon. A
  package inside the agent directory is allowed: it lies inside, and does not
  hold it.
- **A change to them recreates lanes:** they are in `container run`'s
  arguments, and so in the spec hash.

## The queue

- **One serial queue per lane** (`createQueue`) carries everything that
  changes a lane's disk from outside a tool: the start, a fork's setup, each
  turn's commit and snapshot, the bundle, the stop and trim. A tool's gate is
  the queue's tail, so a snapshot cannot overlap the next turn's writes. A
  failed start or fork (`fatal`) breaks the gate, so tools fail with its
  error, until the lane is started again.
- **Your repo's fetch is on a second queue per lane,** in the host, which
  tools never wait on and `take` does.

## Running jj and git (`run.ts`)

- **Every jj command takes `-R <root>`**: `hostJj(root)` on the host,
  `laneJj(runner)` with `-R /workspace` in a lane. A jj command run from the
  wrong directory acts on whatever repo surrounds it (S36 item 28).
- **A path argument is read from the process's directory, not `-R`'s.** Name
  files with the `root:"…"` fileset, as `sideHistory` and `conflictContent`
  do.
- **Decide from exit status, never from printed text.** Output a program
  reads comes from a `-T` template. `execFile` reads all of it: jj exits 3 on
  a broken pipe.
- **`JJ_EDITOR=false`** (`NO_EDITOR`, from core) makes a command that wants
  an editor fail at once rather than hang (S36 items 13, 21). A lane's
  container sets the same variables.

## Revisions and landing (`revisions.ts`, `merge.ts`)

- **`commitTurn`** snapshots. If `@` is `empty`, it commits nothing and
  returns null; otherwise it runs `jj commit` with the title and two trailers,
  `Pineta-Entry` and `Pineta-Lane`, then moves the lane's bookmark.
- **The landing merge is committed at once,** even with nothing to resolve.
  Otherwise an empty merge stays the lane's working copy, which every snapshot
  rewrites. `lanes.test.ts` lands cleanly after both sides moved on and checks
  both are under the bookmark. A mutation shows it can fail.
- **Conflicts** are read with `jj file list -T 'if(conflict, path ++ "\n")'`,
  and a conflicted file's content with `jj file show`: the host cannot read a
  lane's disk.
- **`takeInto`** is `jj rebase -r @ -d <result>` in your working copy, once
  your repo has fetched the result. Your uncommitted changes stay in `@`.

## Tests

- **`plan.test.ts`**: the planners.
- **`lane.test.ts`**: the queue.
- **`lanes.test.ts`**: the executor, and a lane's whole life against jj and
  git, in throwaway repos on the host, with no container. It covers the base,
  a turn, a bundle fetch into your repo, a landing with a conflict, the take,
  a clean landing, and a fork, checked for divergence and immutability.
- **`e2e:lanes`** (`apps/pineta/e2e/lanes.ts`): the same in real containers,
  with the contract test, in about 85 s. It has four sections, `main`,
  `images`, `shared` and `contract`, and `PINETA_LANES_SECTION` picks some.
  Its hosts pass their own `userConfig`, so the person's own lane config
  never applies. Each
  suite-level mutation in `scripts/mutations/lanes.ts` runs only the section
  its check is in.
- **The contract test takes about 7 s:**
  - its volume is 4 GiB, since `e2fsck -f` walks every block group however
    little a volume holds;
  - its writer runs only while the clones are taken;
  - the clones are checked four at a time, in `pineta-fsck:1`, an Alpine
    image with `e2fsprogs` that it builds once and keeps.
