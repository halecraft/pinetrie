# `@pineta/lanes`: technical notes

This package covers a lane's Linux container on its own disk, and the jj and
git run in it and in your repo (ADR-0032 to ADR-0034, ADR-0038). It is the one
package that runs `container`, `jj`, `git` and `cp`. It declares only
`@pineta/core` (`workspace.test.ts`), and the client may not depend on it. It
never imports pi (ADR-0003): the channel into a lane is `packages/pi`'s, and
the host hands it in as an `OpenLink`.

The evidence is in `docs/findings/`: S36 for the jj rules, S39 to S44 for
containers, disks and the helper.

## Where things are

- `plan.ts`: every decision, pure. It covers the container's arguments,
  grants, link mounts, fork, turn, fetch and base steps, the images and
  their tags (`planImages`), what the host finds at startup, and every jj
  step on an offer in your repo.
- `execute.ts`: runs a list of `LaneStep`s in order, on the host or in the
  lane.
- `run.ts`, `bookmarks.ts`, `revisions.ts`, `merge.ts`: jj and git as
  `Runner`s, and the jj logic over them. `offer.ts`: the reads an offer's
  decisions are made from.
- `host.ts`: startup facts, lane configs and shared directories.
- `image.ts`, `runtime.ts`: the image and the lane runtime. `image.ts`
  gathers what `planImages` needs and builds what it plans.
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

- **A fork with no revision above it starts from a copy of your `@`**
  (`planYourCopy`, ADR-0038): a commit on `@`'s parents with `@`'s files, made
  in the lane, so the lane sees your uncommitted edits. Never `@` itself: that
  commit would come back into your repo with the lane's work, and your `@`
  would be divergent (S48 item 10). Its id is known only once made, so the
  fork's config reads it (`jj log -r @-`) when it writes the file. When your
  `@`'s lockfile differs from the base disk's (installed at `@-`), the fork
  installs.
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
  (`refs/heads/pineta/fetched/<i>`). jj imports only branches, remote branches
  and tags, so it does not see a commit fetched with no ref (S44 item 7).
- **By bundle, into your repo** (`planFetch`): `git bundle create -` in the
  lane, written to a host file through the channel as bytes, then
  `git -C <root> fetch <file> +refs/heads/pineta/<lane>:refs/remotes/pineta-<lane>/tip`.
  The bundle excludes what your repo has (`^<have>`). A bundle of the whole
  history is 1.1 MB and 253 ms on Pineta's repo, against 8 KB and 29 ms for
  one commit (S43 item 8).
- **In your repo a lane's history is a remote bookmark**, `tip@pineta-<lane>`
  (ADR-0038). jj imports a ref under `refs/remotes/` with no git remote
  configured, keeps its commits out of your default log, and treats them,
  and their ancestors, as immutable with its builtin config (S48 items 11 and
  19). `laneRefSteps` is the one writer of the ref besides the fetch:
  archiving deletes it, restoring writes it back. In the lane's own repo the
  bookmark stays a local `pineta/<lane>`; `laneTipIn` reads the one in yours,
  `bookmarkOf` the lane's.
- **Pineta used to keep lane bookmarks local in your repo**, made immutable by
  a line in your repo's `immutable_heads()`. `planRetire` undoes that at
  startup, in S48 item 21's order: each `pineta/<lane>` becomes its remote
  bookmark, then the local bookmarks go, then the line. Deleting first would
  leave the lanes' commits in your default log.
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
- **Pineta's default image carries Chromium's headless shell** and its
  libraries, in `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` (ADR-0041). Its
  build is pinned by `PLAYWRIGHT_VERSION`: `prepareImages` takes it from the
  host, which resolves the app's `@playwright/test`, so a Playwright upgrade
  builds the image again. The image's `ENV` reaches an agent's commands, so
  `chromium.launch()` finds the browser with nothing set. A project image
  gets no such argument and no browser.

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
  tools never wait on. Each fetch then refreshes the lane's offer, on the
  host's one queue for your repo (`host/offers.ts`).

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

## Revisions and updates (`revisions.ts`, `merge.ts`)

- **`commitTurn`** snapshots. If `@` is `empty`, it commits nothing and
  returns null; otherwise it runs `jj commit` with the title and two trailers,
  `Pineta-Entry` and `Pineta-Lane`, then moves the lane's bookmark.
- **An update merges a copy of your `@`**, made in the lane (`planYourCopy`),
  never your `@-`: the lane takes what you have, committed or not.
- **The merge is committed at once,** even with nothing to resolve.
  Otherwise an empty merge stays the lane's working copy, which every snapshot
  rewrites. A mutation shows `lanes.test.ts` fails without it.
- **Conflicts** are read with `jj file list -T 'if(conflict, path ++ "\n")'`,
  and a conflicted file's content with `jj file show`: the host cannot read a
  lane's disk.
- **A clean update's changed files come from git** (`git -C /workspace diff
  --name-only`): jj's `--name-only` prints paths from the process's
  directory, which in a lane is not the repo's.

## Offers in your repo (`offer.ts`, `plan.ts`, ADR-0038, ADR-0039)

- **An offer's bookmark is `pineta-offer/<name>`**, the thread's two-word
  name (`offerBookmark`). Take and repair use the bookmark the offer's record
  holds, so an offer built under an older name is still found.

- **Every host command on your repo carries `--ignore-working-copy` and
  `--config operation.username=pineta-host`** (`hostOps`, `hostOp`): it never
  snapshots your working copy, and the evolog says which commits the host
  made (S48 items 1 and 8). Take is the exception: it updates your files, so
  it runs as you (`hostJj`).
- **An offer is built by nonce, never by a commit id kept between steps**
  (`planOffer`): `jj new` has no template, so each commit is named by a
  unique description (`nonceRevset`) until its last step describes it
  (S48 item 18). A step given an old commit id acts on a hidden commit and
  forks the change (S48 item 2).
- **A single offer is a stack of one**: `planOffer` makes one commit per
  source, each with that source's files restored, on the one before; the
  first on the start (a merge when the start names several heads), then all
  rebased onto the target. A stack's sources are the agent's revisions.
- **Where an offer starts is `offerStart`'s revset**: the newest ancestors of
  the lane's tip you already have, your commits and the `pineta.have`
  commits (delivered lane commits, copies of your `@`), S48 items 15 to 17.
  Each have is `present()` (`anyHave`): a copy is made in a lane and reaches
  your repo only with that lane's work, and one never fetched would fail every
  lane's revset.
- **The newest copy of your `@` in the tip's history supersedes older haves**
  (`startHaves`, S51). A copy holds everything you had when it was made. An
  older copy's uncommitted edits, or a delivered commit, may since have
  become commits of yours with other content, and a start merging both
  conflicts where they differ. "Newest in the tip's history", not the lane's
  newest: a branch forked before its parent's update holds only the older
  copy, and must keep it.
- **`startOfOffer` is the one path to a start:** a read of which haves the
  tip's history holds, `startHaves`, then `offerStart`'s revset. The host's
  refresh, its `squash` and `refresh` actions and `stackSpan` all use it: a
  start from another rule would read as a moved start to `planRefresh`, and
  a split would build on it.
- **An offer follows its lane in place** (`planFollowOffer`, S49): `rebase -s`
  back onto the start, `restore --from <tip>`, `rebase -s` onto the target.
  Restoring where it sits would give it the tip's tree, dropping your work
  under it. The change id and bookmark stay, and jj records no operation for
  a restore that changes nothing. `planOffer` and the follow both end with
  `planRefreshOffer`'s rebase.
- **Take is `jj rebase -r <bottom>::<top> -A <target> -B @`** when the target
  is an ancestor of `@`; otherwise only bookmarks move (`planTakeOffer`).
- **`offerFacts` reads an offer by change id once, then names commits**: its
  three edit tests (description, `jj interdiff`, the bottom's parent an
  ancestor of the target), files, conflicts and divergence.
- **`hostCommitIn`** splits a divergent revision's commits by the user of
  each one's newest evolog operation: the host's is abandoned, yours kept.

## Tests

- **`plan.test.ts`**: the planners.
- **`lane.test.ts`**: the queue.
- **`lanes.test.ts`**: the executor, and a lane's whole life against jj and
  git, in throwaway repos on the host, with no container. It covers the base,
  a turn, a bundle fetch into your repo as a remote bookmark, an update with a
  conflict, forks from a turn and from a copy of your `@`, checked for
  divergence and immutability, and a repo beside a fork that the fork's
  config leaves alone; an offer built, refreshed, left, repaired,
  taken under your edits and beside them, the next offer, and a stack; an
  offer following a moved tip, your conflicting commit and a moved start,
  each checked against a fresh build; and retiring a repo from before
  offers.
- **`e2e:lanes`** (`apps/pineta/e2e/lanes.ts`): the same in real containers,
  with a repo in a fork's `/tmp` for the config's scope, and the contract
  test, in about 85 s. Its `images` section also launches Chromium,
  through Pineta's Playwright, on the default image. It has four sections, `main`,
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
