# Working in a Pineta lane

You are an agent in a Pineta lane: a Linux container on a disk of its own,
where you run as root. This note is true of every lane, whatever the
project. The project's own `AGENTS.md` says what is particular to it.

Each fact names the code it comes from in an HTML comment, so whoever
changes Pineta can keep this note true. You can skip them.

## Where things are

- `/workspace` is your own copy of the project: a jj repo, colocated with
  git, on the lane's disk. <!-- packages/core/index.ts WORKSPACE_ROOT -->
- `/mnt/host-working-copy` is the person's working copy, read-only,
  including its `.git` and `.jj`. A path under their working copy that
  someone writes in a message reaches you as the same path under
  `/mnt/host-working-copy`. <!-- packages/core/index.ts HOST_WORKING_COPY -->
  <!-- packages/marginalia/work.ts showHostWorkingCopy -->
- A shared directory, such as `/workspace/.plans` when the person shares
  it, is their own directory mounted read-write. Your edits there are
  visible to them and to every other thread at once, are never committed,
  and cannot be undone through jj. <!-- packages/lanes/plan.ts planMounts -->
- `/pineta` is the install of Pineta that runs this lane, read-only. It
  looks like a Pineta checkout, and it is not your project, even when your
  project is Pineta: its code can differ from yours.
  <!-- packages/lanes/plan.ts PINETA_MOUNT -->
- A dependency the project links from outside itself (`link:`) is mounted
  read-only at its own path. <!-- packages/lanes/plan.ts planLinks -->
- A skill's files are at `/mnt/host` followed by their path on the
  person's machine, read-only. <!-- packages/core/index.ts hostPathInLane -->
- `/pineta-runtime`, `/pineta-git` and `/workspace/.pineta-lane/` are
  Pineta's own. Leave them alone. <!-- packages/lanes/plan.ts RUNTIME_MOUNT -->
  <!-- packages/lanes/plan.ts IGNORE_MOUNT -->
  <!-- packages/lanes/plan.ts LANE_CONFIG_DIR -->

## How your work is recorded

- After each of your messages whose tool calls changed tracked files,
  Pineta runs `jj commit` in `/workspace`. The revision is titled with the
  message's first line, and carries `Pineta-Entry` and `Pineta-Lane`
  trailers. <!-- packages/lanes/revisions.ts commitTurn -->
- So after a turn, `jj st` shows an empty working copy. Your work is below
  it:
  - `jj log -r 'immutable_heads()..'` lists your revisions;
  - `jj diff --from 'heads(immutable())'` shows all of it as one diff.
- Revisions from before this thread began are immutable here: jj refuses to
  rewrite them. <!-- packages/lanes/plan.ts forkConfig -->
- You need not commit. If you do, with jj or git, on top of your work, your
  commit is the turn's revision: Pineta moves the lane's bookmark to it, and
  the person's copy of your work and any branch from that message hold it.
  It keeps your description.
  <!-- packages/lanes/plan.ts planTurnCommit -->
- Don't rewrite revisions you or Pineta already made (`squash`, `rebase`,
  `abandon`, `describe` of an earlier one) unless a Pineta message asks you
  to. Pineta records each turn by the commit id of its revision, and a
  rewrite leaves those records naming commits no longer in your history.
  <!-- packages/marginalia/work.ts planTurnRecord -->
- `JJ_EDITOR` is `false`, so a jj command that would open an editor fails.
  Always pass `-m`, and don't use interactive commands such as `jj split` or
  `jj diffedit`. <!-- packages/core/index.ts NO_EDITOR -->
- Ignored files, such as `node_modules` and build output, stay on the disk,
  and a branch gets them. The person's copy of your work never includes them.

## What the person gets

- Your work reaches the person as one commit on their `@-`, bookmarked
  `pineta-offer/<thread name>`: the offer. They take it when they choose.
  <!-- packages/lanes/plan.ts offerBookmark -->
- While you work, the offer is described `WIP (<thread name>): <first
  message>`. When a run ends, another agent writes its description; you
  don't need to. <!-- packages/marginalia/offer.ts wipDescription -->
- The person can ask for the offer as a stack of revisions. A Pineta message
  then asks you to build it, and says how.
  <!-- packages/marginalia/update.ts planStack -->
- The person sees your files only through the offer, which Pineta brings up
  to date after each turn. Nothing you write appears in their editor.

## What lasts

- The container stops when a run ends, and the next message to this thread
  starts it again. Dev servers, watchers and other background processes end
  with it. <!-- apps/pineta/host/work.ts runEnded -->
- `/workspace` is snapshotted after each turn. A branch from any of your
  messages starts from the disk as it was at that message.
  <!-- packages/lanes/plan.ts planSnapshot -->
- Everything outside `/workspace`, such as `/tmp`, packages from `apt`, or a
  global `npm` install, is on the container's own file system. A branch
  never gets it, and Pineta recreates the container when the image, mounts
  or grants change. <!-- packages/lanes/plan.ts planContainer -->

## The environment

- Pineta's default image is Debian with Node 24, pnpm, git, jj, curl, and
  Chromium's headless shell in `$PLAYWRIGHT_BROWSERS_PATH`. A project with
  its own `pineta.Containerfile` runs that image instead, with only what it
  installs. <!-- packages/lanes/image/Containerfile PLAYWRIGHT_BROWSERS_PATH -->
  <!-- packages/lanes/image.ts projectContainerfile -->
- A lane has 4 GiB of memory. <!-- apps/pineta/host/work.ts LANE_MEMORY -->
- There is no container runtime (`container`, `docker`) and no `gh`.
- There is no model key: pi's `auth.json` is not in the lane.
- There are no credentials: the person's home directory is not mounted. A
  project grants its lanes an ssh agent, named environment variables, or
  read-only mounts in `pineta.json`'s `lanes` key.
  <!-- packages/lanes/plan.ts LaneGrants -->

## The network

- The internet is reachable.
- The person's services on their machine's loopback are not.
- Their services listening on all interfaces are at `192.168.64.1`.
  <!-- docs/02-decisions.md 192.168.64.1 -->

## People

- Several people may write in one thread. Each message you read begins with
  the name of the person who wrote it. <!-- packages/marginalia/chat.ts attributed -->
- When the person sends you their own work ("update from my work"), Pineta
  merges their `@`, uncommitted edits included, into `/workspace`, and a
  note tells you what changed. <!-- packages/lanes/merge.ts mergeYours -->
- If the merge conflicts, a Pineta message asks you to resolve it. Only
  then do you have `ask_for_guidance`: use it when the two sides meant
  different things. <!-- packages/marginalia/land.ts LAND_TYPE -->
  <!-- packages/pi/lanes.ts GUIDANCE_TOOL -->

## When the lane can't do something

Some work needs what a lane lacks: a container runtime, a model key, the
person's credentials, or their localhost. Say what you could not run and
why, and leave it to the person. Don't work around the lane's limits.
