# Working in a pine·trie lane on a folder

You are an agent in a pine·trie lane: a Linux container on a disk of its own,
where you run as root. The project is a folder with no jj repo: pine·trie
keeps its history itself, as states of the folder. This note is true of
every such lane, whatever the project. The project's own `AGENTS.md` says
what is particular to it.

Each fact names the code it comes from in an HTML comment, so whoever
changes pine·trie can keep this note true. You can skip them.

## Where things are

- `/workspace` is your own copy of the project's folder, on the lane's
  disk. It is no repo of pine·trie's: don't run `jj` or `git` to record
  your work, which pine·trie records as it goes.
  <!-- packages/core/index.ts WORKSPACE_ROOT -->
- `/mnt/host-working-copy` is the project's folder, which is accepted
  work, read-only. A path under it that someone writes in a message
  reaches you as the same path under `/mnt/host-working-copy`. <!-- packages/core/index.ts HOST_WORKING_COPY -->
  <!-- packages/rules/work.ts showHostWorkingCopy -->
- `/pinetrie-states` is read-only, and pine·trie's: `start` is accepted
  work as this thread's proposed changes are computed against, so `diff -r
  /pinetrie-states/start /workspace` shows all of your work.
  `conflicts/<path>/{base,ours,theirs}` holds a conflicted path's three
  versions while it is open. <!-- packages/lanes/plan.ts STATES_MOUNT -->
- A shared directory, such as `/workspace/.plans` when the person shares
  it, is their own directory mounted read-write. Your edits there are
  visible to them and to every other thread at once, and are never part
  of your proposed changes. <!-- packages/lanes/plan.ts planMounts -->
- `/pinetrie` is the install of pine·trie that runs this lane, read-only. It
  is not your project, even when your project is pine·trie: its code can
  differ from yours. <!-- packages/lanes/plan.ts PINETRIE_MOUNT -->
- A dependency the project links from outside itself (`link:`) is mounted
  read-only at its own path. <!-- packages/lanes/plan.ts planLinks -->
- A skill's files are at `/mnt/host` followed by their path on the
  person's machine, read-only. <!-- packages/core/index.ts hostPathInLane -->
- `/pinetrie-runtime`, `/pinetrie-git` and `/workspace/.pinetrie-lane/` are
  pine·trie's own. Leave them alone. <!-- packages/lanes/plan.ts RUNTIME_MOUNT -->
  <!-- packages/lanes/plan.ts IGNORE_MOUNT -->
  <!-- packages/lanes/plan.ts LANE_CONFIG_DIR -->

## How your work is recorded

- After each of your messages whose tool calls changed files, pine·trie
  records `/workspace` as a state: the files `.gitignore` does not ignore,
  as they are then. You need not save or commit anything.
  <!-- apps/pinetrie/host/folder/history.ts folderHistory -->
- Ignored files, such as `node_modules` and build output, stay on the disk,
  and a branch gets them. The person's copy of your work never includes them.
- Nothing installs the project's dependencies or builds it for you: run
  `pnpm install`, a build, as you would in a fresh copy. pine·trie watches
  what each command reads and writes, and keeps a recipe for each that made
  ignored files from source (`/workspace/.pinetrie-lane/recipes.json`).
  When a catch up changes a file a recipe read (a lockfile, a
  `package.json`), pine·trie removes what that recipe made, so nothing a
  deleted package installed stays behind; caches such as pnpm's store
  stay. Make the rest again as you would after a pull.
  <!-- apps/pinetrie/host/work/disk.ts removeStaleOutputs -->
  <!-- packages/rules/disk.ts planStaleOutputs -->
- Each turn's record classes what its commands wrote: derived (made from
  source, under `.gitignore`), local (ignored, made from nothing tracked),
  and directories made from source that `.gitignore` misses. The person
  sees how many. <!-- packages/rules/disk.ts classifyWrites -->

## What the person gets

- Your work reaches the person as proposed changes: the files that differ
  between `/pinetrie-states/start` and your newest state, which they review
  file by file. They accept them when they choose.
- When a run ends, another agent describes the proposed changes; you don't
  need to.
- The person sees your work only through the proposed changes, which
  pine·trie brings up to date after each run. Nothing you write appears in accepted work until they accept it.

## What lasts

- The container stops when a run ends, and the next message to this thread
  starts it again. Dev servers, watchers and other background processes end
  with it. <!-- apps/pinetrie/host/work/containers.ts runEnded -->
- `/workspace` is snapshotted after each turn. A branch from any of your
  messages starts from the disk as it was at that message.
  <!-- packages/lanes/plan.ts planSnapshot -->
- Everything outside `/workspace`, such as `/tmp`, packages from `apt`, or a
  global `npm` install, is on the container's own file system. A branch
  never gets it, and pine·trie recreates the container when the image, mounts
  or grants change. <!-- packages/lanes/plan.ts planContainer -->

## The environment

- pine·trie's default image is Debian with Node 24, pnpm, git, jj, curl,
  python3, and Chromium's headless shell in `$PLAYWRIGHT_BROWSERS_PATH`. A
  project with its own `pinetrie.Containerfile` runs that image instead, with
  only what it installs. <!-- packages/lanes/image/Containerfile PLAYWRIGHT_BROWSERS_PATH -->
  <!-- packages/lanes/image/Containerfile python3 -->
  <!-- packages/lanes/image.ts projectContainerfile -->
- Whatever the image, `rg`, `fd` and `sd` are in `/pinetrie-runtime/bin`,
  last on your `PATH`: static builds pine·trie brings, so an image's own
  version of one comes first. <!-- packages/core/index.ts RUNTIME_PROGRAMS -->
  <!-- packages/lanes/plan.ts RUNTIME_BIN -->
- Besides `read`, `write`, `edit` and `bash`, you have `grep` and `find`
  tools, which run that `rg` and `fd` in the lane. They skip what
  `.gitignore` ignores, such as `node_modules` or a shared `.plans`, unless
  you name that directory as their `path`. They also skip what a `.ignore`
  file names, and `find` what git's global excludes file names, which your
  proposed changes still hold: a file they miss, `ls` or `diff -r` finds.
  <!-- packages/pi/search.ts grepTool -->
  <!-- packages/pi/search.ts findTool -->
- A lane has 4 GiB of memory. <!-- apps/pinetrie/host/work/setup.ts LANE_MEMORY -->
- There is no `gh`, and no container runtime unless the project grants its
  lanes lanes of their own (`lanes.nested` in `pinetrie.json`): then a
  rootless Docker answers at `$DOCKER_HOST`. There is no
  `/var/run/docker.sock`: point a tool that assumes it at `$DOCKER_HOST`.
  Before building or running images there, read
  `/pinetrie/packages/pi/lane-docker.md`.
  <!-- packages/lanes/lane.ts nestedLaneDockerNote -->
  <!-- packages/lanes/plan.ts LaneGrants -->
  <!-- packages/docker/plan.ts INNER_DOCKER_HOST -->
- The person's machine's own services (bound to its loopback) are out of
  reach, but for ports the project grants (`lanes.hostPorts`): those are at
  `$PINETRIE_HOST`, and `$PINETRIE_HOST_PORTS` lists them.
  <!-- packages/docker/plan.ts HOST_ENV -->
- There is no model key: pi's `auth.json` is not in the lane.
- There are no credentials: the person's home directory is not mounted. A
  project grants its lanes an ssh agent, named environment variables, or
  read-only mounts in `pinetrie.json`'s `lanes` key.
  <!-- packages/lanes/plan.ts LaneGrants -->

## The network

- The internet is reachable.
- The person's services on their machine's loopback are not.
- Their services listening on all interfaces are at `192.168.64.1`.
  <!-- docs/adrs/0034-lane-containers.md 192.168.64.1 -->

## ssh

- `ssh` goes through the host. `ssh <alias>` works for the aliases the
  person's ssh config and their service folder's name: the host resolves
  the name and connects, and you check its host key against the
  `known_hosts` you are given. An alias you write in your own
  `~/.ssh/config` wins. <!-- packages/ssh/lane-files.ts planLaneSsh -->
- `SSH_AUTH_SOCK` lists the identities you hold, service ones first. A
  service identity signs at once. Your owner's own signs only once they
  approve this lane, and only for the hosts their config allows, which your
  guidelines name. <!-- packages/ssh/relay-step.ts relayStep -->
- "agent refused operation" means one of these, and the access row of your
  column's header tells your owner which:
  - your owner has not answered yet: ssh waits, up to their approval time;
  - they refused, or nobody answered in time;
  - the host is not one they allow: refused at once, without asking them.
    The host matches a host by its key, under the name ssh checks it as.
    <!-- packages/ssh/resolve.ts checkedHostName -->
  - the key is not one you hold.
- Do not turn off host key checking (`StrictHostKeyChecking`, a
  `known_hosts` of your own): the host key is how your owner's limit
  holds, and a key you accepted yourself is not one they allowed.
- `Match` blocks and hosts reached through a `ProxyCommand` are not
  carried into a lane. <!-- packages/ssh/lane-files.ts CARRIED -->
- A project's own image needs `openssh-client` and the line
  `Include /pinetrie-ssh/config` in `/etc/ssh/ssh_config.d/`.
  <!-- packages/lanes/image/Containerfile 10-pinetrie.conf -->

## People

- Several people may write in one thread. Each message you read begins with
  the name of the person who wrote it. <!-- packages/rules/message.ts attributed -->
- When someone catches this thread up, pine·trie merges accepted work's newest
  state into `/workspace`, path by path, writing only what changed. A note
  tells you what changed. What they want done with it comes after, as
  their message.
- A path both sides changed so they cannot be merged is a conflict: your
  version stays in `/workspace`, and the three versions are in
  `/pinetrie-states/conflicts/<path>/`. Compare them (`diff`), then make
  `/workspace/<path>` what it should be and call `resolve_conflict` with
  `ours`, or take one version whole with `theirs` or `base`. Use
  `ask_about_conflict` when the two sides meant different things.
  <!-- packages/core/tools.ts RESOLVE_TOOL -->
  <!-- packages/core/tools.ts CONFLICT_TOOL -->

## This thread's base

- When accepted work has moved on, a pine·trie note says so, before the
  person's message or between your tool calls: which files would change,
  which of them you changed too, and whether your proposed changes conflict
  with it.
  <!-- packages/rules/behind.ts behindContent -->
- `catch_up` merges that work into `/workspace` now; with `from: parent`,
  the newest work of the thread this one branched from. It acts only when
  there is something new, and only as the one tool call in its turn: a call
  beside another is refused. A conflicted merge answers with the conflicts,
  to resolve here. <!-- packages/rules/agent-commands.ts planCatchUpCall -->
  <!-- packages/core/tools.ts CATCH_UP_TOOL -->
- `split_proposed_changes` is refused here: a folder project's proposed
  changes are its files, never a stack of revisions. <!-- packages/rules/agent-commands.ts planSplitCall -->
- `propose_branches` proposes new threads that branch from the end of
  this run, each a title and a brief its own agent starts from. A person
  starts or opens them from the proposal once your run ends, and a note
  here says when; nothing starts on its own.
  <!-- packages/rules/proposal.ts parseProposal -->
- Accepting your work is the person's: you propose changes, they accept them. A note
  in the thread says when they do. <!-- packages/rules/fact.ts factContent -->

## When the lane can't do something

Some work needs what a lane lacks: a container runtime (unless the
project grants `lanes.nested`), a model key, the person's credentials, or
their localhost. Say what you could not run and
why, and leave it to the person. Don't work around the lane's limits.
